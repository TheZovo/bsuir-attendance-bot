import * as groupService from '../../services/groupService.js';
import * as attendanceService from '../../services/attendanceService.js';
import * as keyboards from '../keyboards.js';

export function setupAttendanceHandler(bot) {
  // Trigger from menu: "📋 Отметить пару"
  bot.hears('📋 Отметить пару', async (ctx) => {
    const user = groupService.getUser(ctx.from.id);
    if (!user || (user.role !== 'headman' && user.role !== 'deputy')) {
      return ctx.reply('⛔ Эта функция доступна только старосте группы. Чтобы сменить роль, напиши /role.');
    }

    const group = user.group_number || groupService.getDefaultGroup();
    if (!group) {
      return ctx.reply('⚠️ Номер группы не настроен. Напиши номер группы (например: `310101`).');
    }

    const todayStr = new Date().toISOString().split('T')[0];
    try {
      const lessons = await attendanceService.syncDayLessons(group, todayStr);

      if (!lessons || lessons.length === 0) {
        return ctx.reply(
          `📅 **На сегодня (${todayStr}) пар в расписании нет!** 🎉\n` +
          `Хочешь отметить прошедший день или открыть журнал? Нажми кнопку **"📱 Открыть Журнал"**.`,
          { parse_mode: 'Markdown' }
        );
      }

      return ctx.reply(
        `📋 **Пары на сегодня (${todayStr}) для группы ${group}:**\n\n` +
        `Выбери пару, которую нужно отметить:`,
        {
          parse_mode: 'Markdown',
          reply_markup: keyboards.getLessonSelectionKeyboard(lessons)
        }
      );
    } catch (err) {
      console.error('Error fetching today lessons:', err);
      return ctx.reply(`❌ Ошибка загрузки расписания: ${err.message}`);
    }
  });

  // Handle lesson selection for marking: `mark_lesson:<id>`
  bot.callbackQuery(/^mark_lesson:(\d+)$/, async (ctx) => {
    const lessonId = parseInt(ctx.match[1], 10);
    const data = attendanceService.getLessonAttendance(lessonId);

    if (!data || !data.lesson) {
      return ctx.answerCallbackQuery({ text: 'Пара не найдена', show_alert: true });
    }

    const lesson = data.lesson;
    const students = data.students;

    if (students.length === 0) {
      await ctx.answerCallbackQuery();
      return ctx.editMessageText(
        `⚠️ В группе *${lesson.group_number}* пока нет добавленных студентов.\n\n` +
        `Перейди в **"⚙️ Управление группой"** или открой **Mini App**, чтобы вставить список группы.`,
        { parse_mode: 'Markdown' }
      );
    }

    const currentMarks = {};
    for (const s of students) {
      currentMarks[s.studentId] = s.status;
    }

    await ctx.answerCallbackQuery();
    return ctx.editMessageText(
      `📝 **Отметка посещаемости:**\n` +
      `📚 Предмет: *${lesson.subject} (${lesson.lesson_type})*\n` +
      `🕒 Время: *${lesson.start_time} - ${lesson.end_time || ''}*\n` +
      (lesson.auditory ? `📍 Ауд.: *${lesson.auditory}*\n` : '') +
      `\nНажимай на фамилию студента, чтобы переключить статус:\n` +
      `🟢 Был ➔ 🔴 НБ (неуваж.) ➔ 🟡 УВ (уваж.) ➔ ⚪ Опоздал`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboards.getLessonMarkingKeyboard(lessonId, students.map(s => ({
          id: s.studentId,
          fullName: s.fullName
        })), currentMarks)
      }
    );
  });

  // Handle toggle mark: `toggle_mark:<lessonId>:<studentId>`
  bot.callbackQuery(/^toggle_mark:(\d+):(\d+)$/, async (ctx) => {
    const lessonId = parseInt(ctx.match[1], 10);
    const studentId = parseInt(ctx.match[2], 10);

    const data = attendanceService.getLessonAttendance(lessonId);
    if (!data) return ctx.answerCallbackQuery();

    const studentRecord = data.students.find(s => s.studentId === studentId);
    const currentStatus = studentRecord ? studentRecord.status : 'present';

    // Cycle: present -> absent -> valid_reason -> late -> present
    let nextStatus = 'absent';
    if (currentStatus === 'present') nextStatus = 'absent';
    else if (currentStatus === 'absent') nextStatus = 'valid_reason';
    else if (currentStatus === 'valid_reason') nextStatus = 'late';
    else nextStatus = 'present';

    attendanceService.setAttendance({
      lessonId,
      studentId,
      status: nextStatus,
      markedBy: ctx.from.id
    });

    const updatedData = attendanceService.getLessonAttendance(lessonId);
    const currentMarks = {};
    for (const s of updatedData.students) {
      currentMarks[s.studentId] = s.status;
    }

    await ctx.answerCallbackQuery({
      text: `${studentRecord.fullName}: ${nextStatus === 'present' ? 'Был' : nextStatus === 'absent' ? 'НБ' : nextStatus === 'valid_reason' ? 'УВ' : 'Опоздал'}`
    });

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: keyboards.getLessonMarkingKeyboard(lessonId, updatedData.students.map(s => ({
          id: s.studentId,
          fullName: s.fullName
        })), currentMarks)
      });
    } catch (e) {
      // Ignore identical markup errors
    }
  });

  // Handle all present: `all_present:<lessonId>`
  bot.callbackQuery(/^all_present:(\d+)$/, async (ctx) => {
    const lessonId = parseInt(ctx.match[1], 10);
    attendanceService.markAllPresent(lessonId, ctx.from.id);

    const updatedData = attendanceService.getLessonAttendance(lessonId);
    const currentMarks = {};
    for (const s of updatedData.students) {
      currentMarks[s.studentId] = 'present';
    }

    await ctx.answerCallbackQuery({ text: '✅ Все отмечены присутствующими!' });

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: keyboards.getLessonMarkingKeyboard(lessonId, updatedData.students.map(s => ({
          id: s.studentId,
          fullName: s.fullName
        })), currentMarks)
      });
    } catch (e) {}
  });

  // Handle finish marking: `finish_mark:<lessonId>`
  bot.callbackQuery(/^finish_mark:(\d+)$/, async (ctx) => {
    const lessonId = parseInt(ctx.match[1], 10);
    const data = attendanceService.getLessonAttendance(lessonId);

    if (!data) return ctx.answerCallbackQuery();

    const lesson = data.lesson;
    const students = data.students;

    const present = students.filter(s => s.status === 'present').length;
    const absent = students.filter(s => s.status === 'absent');
    const valid = students.filter(s => s.status === 'valid_reason');
    const late = students.filter(s => s.status === 'late');

    let text = `✅ **Пара успешно сохранена!**\n\n` +
      `📚 Предмет: *${lesson.subject} (${lesson.lesson_type})*\n` +
      `📅 Дата: *${lesson.date}* (${lesson.start_time})\n\n` +
      `👥 **Итоги:**\n` +
      `• Присутствовало: *${present}*\n` +
      `• Отсутствовало (НБ): *${absent.length}*\n` +
      `• По уважительной (УВ): *${valid.length}*\n` +
      (late.length > 0 ? `• Опоздавших: *${late.length}*\n` : '');

    if (absent.length > 0) {
      text += `\n🔴 **Пропустили (НБ):**\n` + absent.map(s => `• ${s.fullName}`).join('\n');
    }
    if (valid.length > 0) {
      text += `\n\n🟡 **Уважительная (УВ):**\n` + valid.map(s => `• ${s.fullName}`).join('\n');
    }

    await ctx.answerCallbackQuery({ text: 'Готово!' });
    await ctx.deleteMessage().catch(() => {});
    return ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: keyboards.getHeadmanMenu()
    });
  });
}
