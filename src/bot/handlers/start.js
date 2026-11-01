import * as groupService from '../../services/groupService.js';
import * as attendanceService from '../../services/attendanceService.js';
import * as bsuirAuth from '../../services/bsuirAuth.js';
import * as bsuirApi from '../../services/bsuirApi.js';
import * as keyboards from '../keyboards.js';
import { findTunnelUrl } from '../../services/tunnelService.js';
import { config } from '../../config.js';

// Temporary in-memory pending state for multi-step prompts (userId -> { step, data })
export const userPendingState = new Map();

export function setupStartHandler(bot) {
  // /start command
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from.id;
    let user = groupService.getUser(telegramId);
    const isMainHeadman = groupService.isMainHeadman(telegramId);

    try {
      if (!user) {
        user = groupService.saveUser({
          telegramId,
          firstName: ctx.from.first_name || '',
          lastName: ctx.from.last_name || '',
          username: ctx.from.username || '',
          role: isMainHeadman ? 'headman' : 'student'
        });
      }

      // If user hasn't connected their student profile or group yet
      if (!user.group_number && !isMainHeadman) {
        return ctx.reply(
          `👋 **Привет, ${ctx.from.first_name}!**\n\n` +
          `Я бот для учёта посещаемости студентов БГУИР с синхронизацией расписания из ИИС.\n\n` +
          `Выбери способ авторизации:\n` +
          `• **Вход через ИИС БГУИР** — автоматически подтянет твоё ФИО, номер студенческого и группу.\n` +
          `• **По номеру студенческого / ФИО** — если хочешь ввести вручную.`,
          {
            parse_mode: 'Markdown',
            reply_markup: keyboards.getRegistrationKeyboard()
          }
        );
      }

      const roleName = isMainHeadman
        ? '👑 Главный староста'
        : user.role === 'headman' || user.role === 'deputy'
          ? '👑 Староста (Зам)'
          : '🎓 Студент';

      // Refresh chat menu button specifically for this user's chat
      const activeUrl = config.webAppUrl || findTunnelUrl();
      if (activeUrl && activeUrl.startsWith('https://')) {
        config.webAppUrl = activeUrl;
        try {
          await ctx.api.setChatMenuButton({
            chat_id: ctx.chat.id,
            menu_button: {
              type: 'web_app',
              text: 'Журнал',
              web_app: { url: activeUrl }
            }
          });
        } catch (e) {
          console.warn('Could not set chat menu button for chat:', ctx.chat.id, e.message);
        }
      }

      const menu = (isMainHeadman || user.role === 'headman' || user.role === 'deputy')
        ? keyboards.getHeadmanMenu()
        : keyboards.getStudentMenu();

      // Send single welcome message with persistent menu attached (no extra bubbles)
      return ctx.reply(
        `👋 С возвращением, *${user.first_name}*!\n\n` +
        `📌 Твоя роль: *${roleName}*\n` +
        `🏫 Группа: *${user.group_number || '562001'}*\n` +
        (user.student_card ? `🪪 Студенческий: \`${user.student_card}\`\n` : '') +
        `\n📱 Откройте **Журнал (Mini App)** через кнопку меню внизу или по ссылке:\n` +
        `${activeUrl || config.webAppUrl}`,
        {
          parse_mode: 'Markdown',
          reply_markup: menu
        }
      );
    } catch (err) {
      console.error('Error in /start handler:', err);
      return ctx.reply('Произошла ошибка при запуске. Пожалуйста, попробуйте еще раз.');
    }
  });

  // Handler to view day roster (who was present and who was not)
  const handleDayRosterSummary = async (ctx) => {
    const telegramId = ctx.from.id;
    const user = groupService.getUser(telegramId);
    const groupNumber = (user && user.group_number) || groupService.getDefaultGroup() || '562001';
    const todayStr = new Date().toISOString().split('T')[0];

    try {
      const lessons = await attendanceService.syncDayLessons(groupNumber, todayStr);
      const students = groupService.getStudents(groupNumber, 0);

      if (lessons.length === 0) {
        return ctx.reply(`📅 *${todayStr}* — В расписании на сегодня пар нет! 🎉`, { parse_mode: 'Markdown' });
      }

      const lessonIds = lessons.map(l => l.id);
      const placeholders = lessonIds.map(() => '?').join(',');
      const { db } = await import('../../db/database.js');
      const marks = db.prepare(`SELECT * FROM attendance WHERE lesson_id IN (${placeholders})`).all(...lessonIds);
      const marksMap = {};
      for (const m of marks) {
        marksMap[`${m.student_id}_${m.lesson_id}`] = m;
      }

      const distinctPairSlots = [...new Set(lessons.map(l => l.lesson_index || attendanceService.getPairSlotFromTime(l.start_time)))];
      const totalPairs = distinctPairSlots.length;
      const totalHours = totalPairs * 2;

      const absentList = [];
      const validList = [];
      let presentFullCount = 0;

      for (const s of students) {
        const studentLessons = lessons.filter(l => l.subgroup === 0 || s.subgroup === 0 || l.subgroup === s.subgroup);
        const absentLessons = [];
        const validLessons = [];

        for (const l of studentLessons) {
          const m = marksMap[`${s.id}_${l.id}`];
          const st = m ? m.status : 'present';
          if (st === 'absent') {
            absentLessons.push(`${l.lesson_index} пара (${l.subject})`);
          } else if (st === 'valid_reason') {
            validLessons.push(`${l.lesson_index} пара (${l.subject}${m.note ? ': ' + m.note : ''})`);
          }
        }

        if (absentLessons.length > 0) {
          absentList.push(`• *${s.full_name}*${s.subgroup ? ` (${s.subgroup}п)` : ''}: ${absentLessons.join(', ')} — *${absentLessons.length * 2}ч*`);
        } else if (validLessons.length > 0) {
          validList.push(`• *${s.full_name}*${s.subgroup ? ` (${s.subgroup}п)` : ''}: ${validLessons.join(', ')}`);
        } else {
          presentFullCount++;
        }
      }

      let msg = `📅 *Посещаемость за день (${todayStr})*\n`;
      msg += `🏫 Группа: *${groupNumber}* | ⏱ Пар: *${totalPairs} (${totalHours} ч.)*\n\n`;

      if (absentList.length > 0) {
        msg += `🔴 *Отсутствовали (НБ — ${absentList.length} чел.):*\n${absentList.join('\n')}\n\n`;
      } else {
        msg += `🔴 *Отсутствовали (НБ):* Нет таких, все были! 👏\n\n`;
      }

      if (validList.length > 0) {
        msg += `🟡 *По уважительной (УВ — ${validList.length} чел.):*\n${validList.join('\n')}\n\n`;
      }

      msg += `🟢 *Присутствовали на всех парах:* ${presentFullCount} из ${students.length} чел.`;

      return ctx.reply(msg, {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getAppInlineKeyboard()
      });
    } catch (err) {
      console.error('Error in handleDayRosterSummary:', err);
      return ctx.reply('Ошибка получения сводки за день: ' + err.message);
    }
  };

  bot.command(['today', 'day', 'roster'], handleDayRosterSummary);
  bot.hears(['👥 Кто был сегодня', '📊 Сводка за день', 'Кто был сегодня'], handleDayRosterSummary);

  // Dedicated commands to open WebApp
  const handleOpenApp = async (ctx) => {
    const activeUrl = config.webAppUrl || findTunnelUrl();
    if (activeUrl && activeUrl.startsWith('https://')) {
      config.webAppUrl = activeUrl;
      try {
        await ctx.api.setChatMenuButton({
          chat_id: ctx.chat.id,
          menu_button: {
            type: 'web_app',
            text: 'Журнал',
            web_app: { url: activeUrl }
          }
        });
      } catch (e) {}
    }

    return ctx.reply(
      `📱 **Журнал посещаемости БГУИР**\n\n` +
      `Нажмите кнопку ниже, чтобы открыть Mini App прямо в Telegram:\n` +
      `_(Либо откройте в браузере Safari / Chrome, если не загружается)_`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getAppInlineKeyboard()
      }
    );
  };

  bot.command(['app', 'webapp', 'journal', 'mini'], handleOpenApp);
  bot.hears(['📱 Открыть Журнал посещаемости', '📱 Открыть Мой Журнал'], handleOpenApp);

  // Helper to prompt for IIS credentials
  const promptForIisLogin = (ctx) => {
    userPendingState.set(ctx.from.id, { step: 'awaiting_iis_credentials' });

    return ctx.reply(
      `🔑 **Авторизация через ИИС БГУИР**\n\n` +
      `Отправьте логин и пароль от вашего личного кабинета ИИС БГУИР (\`iis.bsuir.by\`) **в одном сообщении через пробел**:\n\n` +
      `_Формат:_\n` +
      `\`[логин/номер_студенческого] [пароль]\`\n\n` +
      `_Пример:_\n` +
      `\`56200101 myPassword123\`\n\n` +
      `🔒 _Данные используются для разового подтверждения личности через официальный API БГУИР и загрузки группы и расписания._`,
      { parse_mode: 'Markdown' }
    );
  };

  bot.command(['register', 'iis', 'login'], promptForIisLogin);
  bot.hears(['🔑 Войти через ИИС', '🔑 Привязать ИИС / Студ.'], promptForIisLogin);

  bot.callbackQuery('reg:iis', async (ctx) => {
    await ctx.answerCallbackQuery();
    return promptForIisLogin(ctx);
  });

  // General reason menu commands & hears
  const handleReasonMenu = async (ctx) => {
    return ctx.reply(
      `🏥 **Оформление отсутствия по уважительной причине**\n\n` +
      `Выберите причину отсутствия:\n` +
      `• 🤒 **ОРВИ** — электронный больничный ИИС БГУИР\n` +
      `• 📋 **Справка** — медицинская справка из поликлиники\n` +
      `• 📝 **Заявление** — заявление в деканат / по семейным обст.\n` +
      `• 🎪 **Мероприятие** — спортивные соревнования, олимпиады, конференции\n\n` +
      `_После выбора причины укажите даты отсутствия._`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getValidReasonTypeKeyboard()
      }
    );
  };

  bot.command(['illness', 'reason', 'absent', 'ув', 'причина'], handleReasonMenu);
  bot.hears([
    '🏥 Оформить ОРВИ / Справку',
    '🏥 Оформить причину (ОРВИ / Справка...)',
    '🏥 Уважительная причина'
  ], handleReasonMenu);

  // Helper to prompt for reason dates
  const promptForReasonDates = (ctx, reasonType) => {
    userPendingState.set(ctx.from.id, {
      step: 'awaiting_reason_dates',
      reasonType
    });

    const icons = {
      'ОРВИ': '🤒',
      'Справка': '📋',
      'Заявление': '📝',
      'Мероприятие': '🎪'
    };
    const icon = icons[reasonType] || '🏥';

    return ctx.reply(
      `${icon} **Выбрано: ${reasonType}**\n\n` +
      `Отправьте дату или диапазон дат в формате \`ДД.ММ.ГГГГ\`:\n\n` +
      `_Пример одного дня:_\n` +
      `\`16.10.2026\`\n\n` +
      `_Пример диапазона:_\n` +
      `\`16.10.2026 20.10.2026\` (или через тире: \`16.10.2026 - 20.10.2026\`)\n\n` +
      `В эти дни вам автоматически проставится **УВ** на все пары по расписанию (2 часа за пару).`,
      { parse_mode: 'Markdown' }
    );
  };

  // Direct commands for specific reasons
  bot.command(['orvi', 'орви'], (ctx) => promptForReasonDates(ctx, 'ОРВИ'));
  bot.command(['spravka', 'справка'], (ctx) => promptForReasonDates(ctx, 'Справка'));
  bot.command(['zayavlenie', 'заявление'], (ctx) => promptForReasonDates(ctx, 'Заявление'));
  bot.command(['event', 'мероприятие'], (ctx) => promptForReasonDates(ctx, 'Мероприятие'));

  // Callback for reason type selection
  bot.callbackQuery(/^reason_type:(.+)$/, async (ctx) => {
    const reasonType = ctx.match[1];
    await ctx.answerCallbackQuery();
    return promptForReasonDates(ctx, reasonType);
  });

  // Text message processor for registration & illness dates
  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text.trim();
    const telegramId = ctx.from.id;
    const pending = userPendingState.get(telegramId);

    // 1. Awaiting IIS credentials
    if (pending && pending.step === 'awaiting_iis_credentials') {
      userPendingState.delete(telegramId);

      let username = '';
      let password = '';

      if (text.includes('\n')) {
        const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (lines.length >= 2) {
          username = lines[0];
          password = lines.slice(1).join('\n').trim();
        }
      } else {
        const parts = text.split(/\s+/);
        if (parts.length >= 2) {
          username = parts[0];
          password = parts.slice(1).join(' ').trim();
        }
      }

      if (!username || !password) {
        return ctx.reply('⚠️ Введите логин и пароль через пробел или на двух строках:\n`[логин] [пароль]`', { parse_mode: 'Markdown' });
      }

      const statusMsg = await ctx.reply('⏳ Проверяю данные в ИИС БГУИР...');

      try {
        const authRes = await bsuirAuth.loginToIis(username, password);

        if (!authRes.success) {
          await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
          return ctx.reply(
            `❌ **Ошибка авторизации:** ${authRes.error}\nПопробуйте ещё раз через /register.`,
            { parse_mode: 'Markdown' }
          );
        }

        const profile = authRes.profile;
        const currentUser = groupService.getUser(telegramId);
        const isMainHeadman = groupService.isMainHeadman(telegramId);

        // Group resolution hierarchy
        let grp = profile.groupNumber;
        if (!grp && currentUser && currentUser.group_number) {
          grp = currentUser.group_number;
        }
        if (!grp && isMainHeadman) {
          grp = '562001';
        }
        if (!grp) {
          grp = groupService.getDefaultGroup() || '562001';
        }

        // Cache schedule
        await bsuirApi.fetchGroupSchedule(grp).catch(() => {});

        // Link student
        const student = groupService.linkOrRegisterStudent({
          groupNumber: grp,
          fullName: profile.fullName || ctx.from.first_name || 'Студент',
          studentCard: profile.studentCardNumber,
          telegramId
        });

        // If IIS provided group roster, add students
        let syncedCount = 0;
        if (authRes.groupStudents && authRes.groupStudents.length > 0) {
          groupService.clearGroupStudents(grp, true);
          for (const s of authRes.groupStudents) {
            const sName = s.fullName || s.fio || `${s.lastName || ''} ${s.firstName || ''} ${s.middleName || ''}`.trim();
            if (sName) {
              groupService.addStudent(grp, sName, s.subgroup || 0);
              syncedCount++;
            }
          }
        }

        const menu = isMainHeadman ? keyboards.getHeadmanMenu() : keyboards.getStudentMenu();

        // Delete status message to avoid "Bad Request: inline keyboard expected" with reply keyboard
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

        const rosterMsg = syncedCount > 0
          ? `\n👥 Список группы синхронизирован: *${syncedCount}* студентов из ИИС.`
          : '';

        return ctx.reply(
          `✅ **Успешная авторизация в ИИС БГУИР!**\n\n` +
          `👤 ФИО: *${student.full_name}*\n` +
          `🏫 Группа: *${grp}*\n` +
          `🪪 Студенческий: \`${profile.studentCardNumber}\`${rosterMsg}\n\n` +
          `Ваш профиль привязан. Теперь ваши пропуски и расписание синхронизированы!`,
          {
            parse_mode: 'Markdown',
            reply_markup: menu
          }
        );
      } catch (err) {
        console.error('[IIS Auth Processing Error]:', err);
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        return ctx.reply(`❌ Ошибка авторизации: ${err.message}`);
      }
    }

    // 2. Awaiting illness dates
    if (pending && pending.step === 'awaiting_reason_dates') {
      const reasonType = pending.reasonType || 'ОРВИ';

      // Parse single date or two dates e.g. "16.10.2026", "16.10.2026 20.10.2026", "16.10.2026 - 20.10.2026"
      const dateParts = text.replace(/[\-—–]+/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (dateParts.length === 0) {
        return ctx.reply('⚠️ Введите дату или диапазон дат, например: `16.10.2026` или `16.10.2026 20.10.2026`', { parse_mode: 'Markdown' });
      }

      const parseDate = (str) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const p = str.split('.');
        if (p.length === 3) {
          const year = p[2].length === 2 ? `20${p[2]}` : p[2];
          return `${year}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
        }
        if (p.length === 2) {
          const currentYear = new Date().getFullYear();
          return `${currentYear}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
        }
        return null;
      };

      let startDate = parseDate(dateParts[0]);
      let endDate = dateParts.length > 1 ? parseDate(dateParts[1]) : startDate;

      if (!startDate || !endDate) {
        return ctx.reply('⚠️ Неверный формат дат.\nПример одной даты: `16.10.2026`\nПример диапазона: `16.10.2026 20.10.2026`', { parse_mode: 'Markdown' });
      }

      if (startDate > endDate) {
        const tmp = startDate;
        startDate = endDate;
        endDate = tmp;
      }

      userPendingState.delete(telegramId);

      let student = groupService.findStudentByTelegram(telegramId);
      const user = groupService.getUser(telegramId);

      if (!student && user && user.student_id) {
        student = groupService.getStudents(user.group_number).find(s => s.id === user.student_id);
      }

      if (!student) {
        const group = (user && user.group_number) || groupService.getDefaultGroup() || '562001';
        student = groupService.linkOrRegisterStudent({
          groupNumber: group,
          fullName: (user && user.first_name) || ctx.from.first_name || 'Студент',
          telegramId
        });
      }

      const statusMsg = await ctx.reply('⏳ Обрабатываю расписание и оформляю уважительную причину...');

      try {
        const res = await attendanceService.submitValidReason({
          studentId: student.id,
          telegramId,
          reasonType,
          startDate,
          endDate,
          note: `Оформлено через бота`
        });

        // Notify Main Headman
        try {
          await ctx.api.sendMessage(
            config.mainHeadmanId,
            `📢 **Студент оформил уважительную причину!**\n\n` +
            `👤 Студент: *${student.full_name}*\n` +
            `🏫 Группа: *${student.group_number}*\n` +
            `📋 Причина: *${reasonType}*\n` +
            `📅 Период: с *${startDate}* по *${endDate}*\n` +
            `⏳ Автоматически проставлено: *${res.markedLessonsCount}* пар (*${res.markedHours}* ч. УВ)`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {}

        return ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `✅ **${reasonType} успешно оформлено!**\n\n` +
          `📅 Период: с *${startDate}* по *${endDate}*\n` +
          `🕒 Проставлено уважительных пропусков (УВ): *${res.markedLessonsCount} пар (${res.markedHours} часов)*.\n\n` +
          `Староста группы уведомлён. Отметки уже внесены в электронный журнал!`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        return ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `❌ Ошибка: ${err.message}`);
      }
    }

    // 4. Awaiting bulk student text
    if (pending && pending.step === 'awaiting_bulk_students') {
      userPendingState.delete(telegramId);
      const user = groupService.getUser(telegramId);
      const grp = (user && user.group_number) || groupService.getDefaultGroup() || '562001';

      const res = groupService.bulkAddStudents(grp, text);
      const allStudents = groupService.getStudents(grp);

      return ctx.reply(
        `✅ **Список группы ${grp} обновлен!**\n\n` +
        `📥 Распознано и добавлено: *${res.addedCount}* студентов.\n` +
        `👥 Всего студентов в базе: *${allStudents.length}* чел.\n\n` +
        `Теперь вы можете отмечать их на занятиях или просматривать в Mini App!`,
        {
          parse_mode: 'Markdown',
          reply_markup: keyboards.getHeadmanMenu()
        }
      );
    }

    // 5. Awaiting credentials to sync students from IIS
    if (pending && pending.step === 'awaiting_iis_sync_credentials') {
      userPendingState.delete(telegramId);
      let username = '';
      let password = '';
      if (text.includes('\n')) {
        const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        if (lines.length >= 2) {
          username = lines[0];
          password = lines.slice(1).join('\n').trim();
        }
      } else {
        const parts = text.split(/\s+/);
        if (parts.length >= 2) {
          username = parts[0];
          password = parts.slice(1).join(' ').trim();
        }
      }

      if (!username || !password) {
        return ctx.reply('⚠️ Введите логин и пароль через пробел или на двух строках:\n`[логин] [пароль]`', { parse_mode: 'Markdown' });
      }

      const statusMsg = await ctx.reply('⏳ Загружаю список группы из ИИС БГУИР...');

      try {
        const authRes = await bsuirAuth.loginToIis(username, password);
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

        if (!authRes.success) {
          return ctx.reply(`❌ Ошибка ИИС: ${authRes.error}`);
        }

        const user = groupService.getUser(telegramId);
        const grp = authRes.profile.groupNumber || (user && user.group_number) || '562001';

        if (authRes.groupStudents && authRes.groupStudents.length > 0) {
          groupService.clearGroupStudents(grp, true);
          for (const s of authRes.groupStudents) {
            const sName = s.fullName || s.fio || '';
            if (sName) {
              groupService.addStudent(grp, sName, s.subgroup || 0);
            }
          }
          const all = groupService.getStudents(grp);
          return ctx.reply(
            `✅ **Список студентов успешно загружен из ИИС!**\n\n` +
            `🏫 Группа: *${grp}*\n` +
            `👥 Загружено студентов: *${authRes.groupStudents.length}*\n` +
            `Всего в базе: *${all.length}* чел.\n\n` +
            `Список сохранен и синхронизирован с журналом посещаемости!`,
            {
              parse_mode: 'Markdown',
              reply_markup: keyboards.getHeadmanMenu()
            }
          );
        } else {
          return ctx.reply(
            `⚠️ В вашем личном кабинете ИИС нет отдельного списка одногруппников, либо группа пока не заполнена в системе.\n\n` +
            `Вы можете добавить студентов списком через кнопку **"➕ Добавить студентов списком"** (просто скопируйте и вставьте список).`,
            {
              reply_markup: keyboards.getGroupSettingsKeyboard()
            }
          );
        }
      } catch (err) {
        await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        return ctx.reply(`❌ Ошибка при синхронизации: ${err.message}`);
      }
    }

    return next();
  });

  // Students list display
  const handleStudentsList = async (ctx) => {
    const telegramId = ctx.from.id;
    const user = groupService.getUser(telegramId);
    const grp = (user && user.group_number) || groupService.getDefaultGroup() || '562001';
    const students = groupService.getStudents(grp);

    if (students.length === 0) {
      return ctx.reply(
        `👥 **Список группы ${grp} пуст**\n\n` +
        `Выберите способ добавления:`,
        {
          reply_markup: keyboards.getGroupSettingsKeyboard()
        }
      );
    }

    let text = `👥 **Список группы ${grp} (${students.length} чел.):**\n\n`;
    students.forEach((s, i) => {
      const sub = s.subgroup ? ` (${s.subgroup} пг)` : '';
      const icon = s.telegram_id && groupService.isMainHeadman(s.telegram_id) ? '👑 ' : '• ';
      text += `${i + 1}. ${icon}${s.full_name}${sub}\n`;
    });

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboards.getGroupSettingsKeyboard()
    });
  };

  bot.hears('👥 Список группы', handleStudentsList);
  bot.command('students', handleStudentsList);

  // Command to change or view student subgroups: /subgroup <номер или фамилия> <подгруппа 1, 2 или 0>
  bot.command(['subgroup', 'подгруппа'], async (ctx) => {
    const telegramId = ctx.from.id;
    const user = groupService.getUser(telegramId);
    if (!groupService.isMainHeadman(telegramId) && (!user || (user.role !== 'headman' && user.role !== 'deputy'))) {
      return ctx.reply('⛔ Только староста может изменять подгруппы студентов.');
    }

    const grp = (user && user.group_number) || groupService.getDefaultGroup() || '562001';
    const students = groupService.getStudents(grp);

    const parts = ctx.message.text.trim().split(/\s+/).slice(1);
    if (parts.length < 2) {
      let msg = `⚙️ **Управление подгруппами группы ${grp}:**\n\n`;
      msg += `_Формат команды:_\n\`/subgroup [номер в списке] [подгруппа 1, 2 или 0]\`\n\n_Примеры:_\n`;
      msg += `• \`/subgroup 5 1\` — установить 5-му студенту 1-ю подгруппу\n`;
      msg += `• \`/subgroup 5 2\` — установить 5-му студенту 2-ю подгруппу\n`;
      msg += `• \`/subgroup 5 0\` — установить общую (вся группа)\n\n`;
      msg += `👥 **Текущий список студентов:**\n`;
      students.forEach((s, i) => {
        const sub = s.subgroup ? ` [${s.subgroup} п/г]` : ' [вся группа]';
        msg += `${i + 1}. ${s.full_name}${sub}\n`;
      });
      return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    const targetInput = parts[0];
    const targetSub = parseInt(parts[1], 10);
    const validSub = (targetSub === 1 || targetSub === 2) ? targetSub : 0;

    let targetStudent = null;
    const index = parseInt(targetInput, 10);
    if (!isNaN(index) && index >= 1 && index <= students.length) {
      targetStudent = students[index - 1];
    } else {
      targetStudent = students.find(s => s.full_name.toLowerCase().includes(targetInput.toLowerCase()));
    }

    if (!targetStudent) {
      return ctx.reply(`❌ Студент "${targetInput}" не найден в группе ${grp}.`);
    }

    groupService.updateStudentSubgroup(targetStudent.id, validSub);
    const subLabel = validSub === 0 ? 'Вся группа' : `${validSub}-я подгруппа`;

    return ctx.reply(
      `✅ **Подгруппа успешно обновлена!**\n\n` +
      `👤 Студент: *${targetStudent.full_name}*\n` +
      `🏷 Новая подгруппа: *${subLabel}*\n` +
      `🏫 Группа: *${grp}*\n\n` +
      `Изменения сразу вступили в силу в расписании и журнале посещаемости!`,
      { parse_mode: 'Markdown' }
    );
  });

  // Clear unlinked students callback
  bot.callbackQuery('admin:clear_students', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = groupService.getUser(telegramId);
    if (!groupService.isMainHeadman(telegramId) && (!user || (user.role !== 'headman' && user.role !== 'deputy'))) {
      return ctx.answerCallbackQuery({ text: '⛔ Только староста может очищать список.', show_alert: true });
    }

    const grp = (user && user.group_number) || groupService.getDefaultGroup() || '562001';
    const deletedCount = groupService.clearGroupStudents(grp, true);
    await ctx.answerCallbackQuery({ text: 'Список очищен' });

    return ctx.reply(
      `🗑 Непривязанные студенты группы *${grp}* удалены (удалено: ${deletedCount}).\n\n` +
      `Теперь вы можете загрузить чистый список из ИИС или вставить вручную.`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getGroupSettingsKeyboard()
      }
    );
  });

  // Handle application for headman: "📩 Подать заявку на старосту"
  bot.hears('📩 Подать заявку на старосту', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = groupService.getUser(telegramId);

    if (groupService.isMainHeadman(telegramId)) {
      return ctx.reply('👑 Вы уже являетесь Главным старостой!');
    }

    if (user && (user.role === 'headman' || user.role === 'deputy')) {
      return ctx.reply('👑 У вас уже есть права старосты/замстаросты!');
    }

    const group = (user && user.group_number) || groupService.getDefaultGroup() || '562001';

    const req = groupService.createHeadmanRequest({
      telegramId,
      firstName: ctx.from.first_name || '',
      username: ctx.from.username || '',
      groupNumber: group
    });

    await ctx.reply(
      `📩 **Ваша заявка на получение прав старосты группы ${group} отправлена!**\n\n` +
      `Главный староста рассмотрит её в ближайшее время.`,
      { parse_mode: 'Markdown' }
    );

    try {
      const userTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
      await ctx.api.sendMessage(
        config.mainHeadmanId,
        `🔔 **Новая заявка на старосту / замстаросты!**\n\n` +
        `👤 Студент: *${ctx.from.first_name || ''}* (${userTag})\n` +
        `🆔 Telegram ID: \`${telegramId}\`\n` +
        `🏫 Группа: *${group}*\n\n` +
        `Одобрить выдачу прав на отметку посещаемости?`,
        {
          parse_mode: 'Markdown',
          reply_markup: keyboards.getHeadmanApprovalKeyboard(req.id)
        }
      );
    } catch (e) {}
  });

  // Handle approval callback
  bot.callbackQuery(/^approve_headman:(\d+)$/, async (ctx) => {
    if (!groupService.isMainHeadman(ctx.from.id)) {
      return ctx.answerCallbackQuery({ text: '⛔ Только главный староста может одобрять заявки.', show_alert: true });
    }

    const reqId = parseInt(ctx.match[1], 10);
    const resolved = groupService.resolveHeadmanRequest(reqId, true);

    await ctx.answerCallbackQuery({ text: '✅ Заявка одобрена!' });
    await ctx.editMessageText(
      `✅ **Заявка #${reqId} одобрена!**\n\n` +
      `Студенту выданы права старосты для группы *${resolved?.group_number || ''}*.`,
      { parse_mode: 'Markdown' }
    );

    if (resolved && resolved.telegram_id) {
      try {
        await ctx.api.sendMessage(
          resolved.telegram_id,
          `🎉 **Ваша заявка на старосту одобрена!**\n\n` +
          `Теперь вам доступны функции отметки посещаемости и управление группой.`,
          {
            parse_mode: 'Markdown',
            reply_markup: keyboards.getHeadmanMenu()
          }
        );
      } catch (e) {}
    }
  });

  // Handle reject callback
  bot.callbackQuery(/^reject_headman:(\d+)$/, async (ctx) => {
    if (!groupService.isMainHeadman(ctx.from.id)) {
      return ctx.answerCallbackQuery({ text: '⛔ Доступно только главному старосте.', show_alert: true });
    }

    const reqId = parseInt(ctx.match[1], 10);
    groupService.resolveHeadmanRequest(reqId, false);

    await ctx.answerCallbackQuery({ text: '❌ Заявка отклонена' });
    return ctx.editMessageText(`❌ **Заявка #${reqId} отклонена.**`, { parse_mode: 'Markdown' });
  });
}
