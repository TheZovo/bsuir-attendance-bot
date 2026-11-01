import * as groupService from '../../services/groupService.js';
import * as bsuirApi from '../../services/bsuirApi.js';
import * as keyboards from '../keyboards.js';
import { userPendingState } from './start.js';

export function setupAdminHandler(bot) {
  // Command to switch role
  bot.command('role', async (ctx) => {
    return ctx.reply('Выбери свою роль в группе:', {
      reply_markup: keyboards.getRoleSelectionKeyboard()
    });
  });

  // Trigger from menu: "⚙️ Управление группой"
  bot.hears('⚙️ Управление группой', async (ctx) => {
    const user = groupService.getUser(ctx.from.id);
    if (!user || (user.role !== 'headman' && user.role !== 'deputy')) {
      return ctx.reply('⛔ Управление группой доступно только старосте.');
    }

    const group = user.group_number || groupService.getDefaultGroup() || '562001';
    const students = groupService.getStudents(group);

    return ctx.reply(
      `⚙️ **Панель управления старосты:**\n\n` +
      `🏫 Группа: *${group}*\n` +
      `👥 Студентов в базе: *${students.length}*\n\n` +
      `Выберите действие:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getGroupSettingsKeyboard()
      }
    );
  });

  // Admin callbacks
  bot.callbackQuery('admin:sync_bsuir', async (ctx) => {
    const user = groupService.getUser(ctx.from.id);
    const group = (user && user.group_number) || groupService.getDefaultGroup() || '562001';

    await ctx.answerCallbackQuery({ text: 'Синхронизирую с ИИС БГУИР...' });

    try {
      const data = await bsuirApi.fetchGroupSchedule(group);
      const subjects = await bsuirApi.getUniqueSubjects(group);

      return ctx.editMessageText(
        `✅ **Расписание группы ${group} успешно синхронизировано с ИИС БГУИР!**\n\n` +
        `📚 Найдено уникальных предметов: *${subjects.length}*\n` +
        `📅 Дней в расписании: *${data.schedules ? Object.keys(data.schedules).length : 0}*\n\n` +
        `Теперь вы можете отмечать пары прямо в боте или в Mini App.`,
        {
          parse_mode: 'Markdown',
          reply_markup: keyboards.getGroupSettingsKeyboard()
        }
      );
    } catch (err) {
      return ctx.editMessageText(`❌ Ошибка синхронизации с БГУИР: ${err.message}`, {
        reply_markup: keyboards.getGroupSettingsKeyboard()
      });
    }
  });

  bot.callbackQuery('admin:change_group', async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.reply(
      `🏫 **Отправьте номер группы БГУИР** (например: \`310101\` или \`451001\`):\n\n` +
      `Я проверю его через ИИС БГУИР и сразу подгружу расписание.`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.callbackQuery('admin:bulk_students', async (ctx) => {
    await ctx.answerCallbackQuery();
    userPendingState.set(ctx.from.id, { step: 'awaiting_bulk_students' });
    return ctx.reply(
      `👥 **Добавление списка студентов:**\n\n` +
      `Отправьте список студентов сюда ответным сообщением (каждое ФИО с новой строки, можно с номерами и подгруппами):\n\n` +
      `_Пример:_\n` +
      `1. Иванов Иван Иванович (1 подгруппа)\n` +
      `2. Петров Петр Алексеевич (2 подгруппа)\n` +
      `3. Сидоров Алексей Сергеевич\n\n` +
      `_Подгруппы распознаются автоматически ((1), (2), [1 пг], и т.д.)._`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.callbackQuery('admin:sync_iis_students', async (ctx) => {
    await ctx.answerCallbackQuery();
    userPendingState.set(ctx.from.id, { step: 'awaiting_iis_sync_credentials' });
    return ctx.reply(
      `🔑 **Синхронизация студентов из ИИС БГУИР**\n\n` +
      `Отправьте логин и пароль от ИИС БГУИР (\`iis.bsuir.by\`) через пробел или на двух строках:\n\n` +
      `\`[логин] [пароль]\`\n\n` +
      `Бот загрузит официальный список группы из личного кабинета ИИС и обновит журнал.`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.callbackQuery('admin:add_subject', async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.reply(
      `➕ **Добавление своего предмета:**\n\n` +
      `Отправьте команду в формате:\n` +
      `\`/add_subject [Краткое имя] | [Полное имя] | [Тип (ЛК/ПЗ/ЛР)] | [Преподаватель]\`\n\n` +
      `_Пример:_\n` +
      `\`/add_subject Военная кафедра | Военная подготовка | ПЗ | Иванов И.И.\``,
      { parse_mode: 'Markdown' }
    );
  });

  // /add_subject command
  bot.command('add_subject', async (ctx) => {
    const user = groupService.getUser(ctx.from.id);
    if (!user || user.role !== 'headman') {
      return ctx.reply('⛔ Доступно только старосте.');
    }
    const group = user.group_number || groupService.getDefaultGroup() || '562001';
    const text = ctx.message.text.replace('/add_subject', '').trim();
    const parts = text.split('|').map(s => s.trim());

    if (parts.length < 1 || !parts[0]) {
      return ctx.reply('⚠️ Укажите хотя бы название предмета: `/add_subject Философия`', { parse_mode: 'Markdown' });
    }

    const name = parts[0];
    const fullName = parts[1] || name;
    const lessonType = parts[2] || 'ПЗ';
    const teacher = parts[3] || '';

    groupService.addCustomSubject(group, { name, fullName, lessonType, teacher });

    return ctx.reply(`✅ Предмет *${name}* (${lessonType}) успешно добавлен в группу ${group}!`, {
      parse_mode: 'Markdown'
    });
  });

  // Listen for 6-digit group numbers
  bot.hears(/^\d{6}$/, async (ctx) => {
    const groupNumber = ctx.message.text.trim();
    const telegramId = ctx.from.id;

    const statusMsg = await ctx.reply(`⏳ Проверяю группу *${groupNumber}* в ИИС БГУИР...`, { parse_mode: 'Markdown' });

    try {
      await bsuirApi.fetchGroupSchedule(groupNumber);
      groupService.setDefaultGroup(groupNumber);
      const isHeadman = groupService.isMainHeadman(telegramId);
      const user = groupService.getUser(telegramId);
      const userRole = isHeadman ? 'headman' : (user ? user.role : 'student');

      groupService.saveUser({ telegramId, groupNumber, role: userRole });

      const meta = groupService.getGroupMeta(groupNumber);
      const faculty = meta && meta.faculty ? `\nФакультет: *${meta.faculty}*` : '';
      const menu = (isHeadman || userRole === 'headman' || userRole === 'deputy')
        ? keyboards.getHeadmanMenu()
        : keyboards.getStudentMenu();

      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      return ctx.reply(
        `✅ **Группа ${groupNumber} успешно подключена!**${faculty}\n\n` +
        `Расписание подгружено из базы БГУИР. Теперь вы можете просматривать расписание и отслеживать посещаемость!`,
        {
          parse_mode: 'Markdown',
          reply_markup: menu
        }
      );
    } catch (err) {
      const isHeadman = groupService.isMainHeadman(telegramId);
      const user = groupService.getUser(telegramId);
      const userRole = isHeadman ? 'headman' : (user ? user.role : 'student');
      const menu = (isHeadman || userRole === 'headman' || userRole === 'deputy')
        ? keyboards.getHeadmanMenu()
        : keyboards.getStudentMenu();

      await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
      return ctx.reply(
        `⚠️ Не удалось найти расписание для группы *${groupNumber}* в ИИС БГУИР (${err.message}).\n` +
        `Группа установлена, но расписание можно заполнять вручную или синхронизировать позже.`,
        {
          parse_mode: 'Markdown',
          reply_markup: menu
        }
      );
    }
  });

  // Listen for multiline student list input
  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith('/') || text.length < 5) return next();

    // Check if it looks like a list of students (multiple lines with Cyrillic names)
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    if (lines.length >= 2 && /[А-Яа-яЁё]/.test(text)) {
      const user = groupService.getUser(ctx.from.id);
      if (user && user.role === 'headman') {
        const group = user.group_number || groupService.getDefaultGroup() || '562001';
        const res = groupService.bulkAddStudents(group, text);
        return ctx.reply(
          `👥 **Импорт студентов завершен!**\n\n` +
          `Добавлено: *${res.addedCount}* из ${res.totalParsed}\n` +
          `Группа: *${group}*\n\n` +
          `Теперь они отображаются в журнале посещаемости!`,
          {
            parse_mode: 'Markdown',
            reply_markup: keyboards.getHeadmanMenu()
          }
        );
      }
    }

    return next();
  });
}
