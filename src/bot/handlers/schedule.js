import { InlineKeyboard } from 'grammy';
import * as groupService from '../../services/groupService.js';
import * as attendanceService from '../../services/attendanceService.js';
import * as bsuirApi from '../../services/bsuirApi.js';
import { config } from '../../config.js';

export function setupScheduleHandler(bot) {
  // Trigger from menu: "📅 Расписание"
  bot.hears('📅 Расписание', async (ctx) => {
    const user = groupService.getUser(ctx.from.id);
    const group = (user && user.group_number) || groupService.getDefaultGroup() || '562001';

    const kb = new InlineKeyboard()
      .text('📌 На сегодня', `sched:today:${group}`)
      .text('🌅 На завтра', `sched:tomorrow:${group}`)
      .row()
      .url('📱 Вся неделя в Mini App', `${config.webAppUrl}?tab=schedule`);

    return ctx.reply(
      `📅 **Расписание занятий для группы ${group}:**\n\n` +
      `Выбери нужный день или открой полное расписание:`,
      {
        parse_mode: 'Markdown',
        reply_markup: kb
      }
    );
  });

  // Schedule callback
  bot.callbackQuery(/^sched:(today|tomorrow):(.+)$/, async (ctx) => {
    const mode = ctx.match[1];
    const group = ctx.match[2];

    const targetDate = new Date();
    if (mode === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    const dateStr = targetDate.toISOString().split('T')[0];

    try {
      const lessons = await bsuirApi.getLessonsForDate(group, targetDate);
      const weekNum = await bsuirApi.getWeekNumberForDate(targetDate);
      const dayTitle = mode === 'today' ? 'Сегодня' : 'Завтра';

      if (!lessons || lessons.length === 0) {
        await ctx.answerCallbackQuery();
        return ctx.editMessageText(
          `📅 **Расписание на ${dayTitle.toLowerCase()} (${dateStr})**\n` +
          `Группа: *${group}* (учебная неделя: *${weekNum}*)\n\n` +
          `🎉 **Занятий нет! Можно отдыхать.**`,
          { parse_mode: 'Markdown' }
        );
      }

      let text = `📅 **Расписание на ${dayTitle.toLowerCase()} (${dateStr})**\n` +
        `Группа: *${group}* (учебная неделя: *${weekNum}*)\n\n`;

      for (const l of lessons) {
        const subg = l.subgroup ? ` [${l.subgroup} п/г]` : '';
        const aud = l.auditory ? ` (ауд. ${l.auditory})` : '';
        const teacher = l.teacher ? `\n   👨‍🏫 ${l.teacher}` : '';
        text += `⏰ *${l.startTime} - ${l.endTime}* | *${l.subject}* (${l.lessonType})${subg}${aud}${teacher}\n\n`;
      }

      await ctx.answerCallbackQuery();
      return ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .url('📱 Открыть журнал', config.webAppUrl)
      });
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Ошибка загрузки расписания', show_alert: true });
    }
  });

  // Trigger from menu: "📊 Мои пропуски"
  bot.hears('📊 Мои пропуски', async (ctx) => {
    const telegramId = ctx.from.id;
    let user = groupService.getUser(telegramId);
    const group = (user && user.group_number) || groupService.getDefaultGroup() || '562001';

    let student = groupService.findStudentByTelegram(telegramId);
    if (!student && user && user.student_id) {
      student = groupService.getStudents(group).find(s => s.id === user.student_id);
    }

    if (!student) {
      // Allow linking student profile
      const students = groupService.getStudents(group);
      if (students.length === 0) {
        return ctx.reply(
          `ℹ️ В группе *${group}* пока не внесены студенты.\nСтароста может вставить список группы в Mini App.`,
          { parse_mode: 'Markdown' }
        );
      }

      const kb = new InlineKeyboard();
      for (const s of students.slice(0, 8)) {
        kb.text(s.full_name, `link_student:${s.id}`).row();
      }
      kb.url('📱 Открыть в Mini App', config.webAppUrl);

      return ctx.reply(
        `🔍 Чтобы отслеживать свои пропуски, выбери свою фамилию из списка:`,
        {
          reply_markup: kb
        }
      );
    }

    const stats = attendanceService.getStudentStats(student.id);
    const sum = stats.summary;

    let text = `📊 **Ваша статистика посещаемости:**\n` +
      `👤 Студент: *${student.full_name}*\n` +
      `🏫 Группа: *${group}*\n\n` +
      `📌 **Всего пропущено: ${sum.totalMissedHours} ч.** (пар: ${sum.totalMissedHours / 2})\n` +
      `🔴 Неуважительная (НБ): *${sum.totalNbHours} ч.*\n` +
      `🟡 Уважительная (УВ): *${sum.totalUvHours} ч.*\n` +
      (sum.totalLateCount > 0 ? `⚪ Опозданий: *${sum.totalLateCount}*\n` : '');

    if (sum.totalNbHours >= 20) {
      text += `\n⚠️ *Внимание:* у вас более 20 часов пропусков без уважительной причины! Возможен вызов в деканат.\n`;
    }

    if (stats.bySubject.length > 0) {
      text += `\n📚 **Пропуски по предметам:**\n`;
      for (const s of stats.bySubject) {
        text += `• *${s.subject}* (${s.lessonType}): ${s.totalMissedHours} ч. (НБ: ${s.nbHours}, УВ: ${s.uvHours})\n`;
      }
    } else {
      text += `\n🎉 У вас нет пропусков! Отличная посещаемость!`;
    }

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .url('📱 Открыть подробную таблицу', `${config.webAppUrl}?studentId=${student.id}`)
    });
  });

  // Handle student profile link callback: `link_student:<id>`
  bot.callbackQuery(/^link_student:(\d+)$/, async (ctx) => {
    const studentId = parseInt(ctx.match[1], 10);
    const telegramId = ctx.from.id;

    groupService.linkUserToStudent(telegramId, studentId);
    await ctx.answerCallbackQuery({ text: 'Профиль успешно привязан!' });

    return ctx.reply(
      `✅ Твой профиль успешно привязан! Теперь ты можешь нажать **"📊 Мои пропуски"** или открыть **Mini App**, чтобы видеть всю историю посещений.`,
      { parse_mode: 'Markdown' }
    );
  });

  // Trigger from menu: "📈 Статистика группы" (Headman)
  bot.hears('📈 Статистика группы', async (ctx) => {
    const user = groupService.getUser(ctx.from.id);
    if (!user || (user.role !== 'headman' && user.role !== 'deputy')) {
      return ctx.reply('⛔ Функция доступна только старосте группы.');
    }

    const group = user.group_number || groupService.getDefaultGroup() || '562001';
    const summary = attendanceService.getGroupSummary(group);

    let text = `📈 **Сводная статистика группы ${group}:**\n\n` +
      `👥 Всего студентов: *${summary.studentCount}*\n` +
      `🕒 Всего пропущено группой: *${summary.totalMissedHours} ч.*\n` +
      `🔴 По неуважительной (НБ): *${summary.totalNbHours} ч.*\n` +
      `🟡 По уважительной (УВ): *${summary.totalUvHours} ч.*\n\n`;

    if (summary.topAbsentees.length > 0) {
      text += `🏆 **Топ по пропускам:**\n`;
      let rank = 1;
      for (const s of summary.topAbsentees) {
        if (s.totalHours === 0) continue;
        text += `${rank++}. *${s.fullName}* — ${s.totalHours} ч. (НБ: ${s.nbHours}, УВ: ${s.uvHours})\n`;
      }
    }

    return ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .url('📱 Открыть полную таблицу в Mini App', config.webAppUrl)
    });
  });
}
