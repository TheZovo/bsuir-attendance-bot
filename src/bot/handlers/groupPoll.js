import * as groupPollService from '../../services/groupPollService.js';
import * as groupService from '../../services/groupService.js';
import * as attendanceService from '../../services/attendanceService.js';
import * as bsuirApi from '../../services/bsuirApi.js';
import { config } from '../../config.js';

/**
 * Setup handlers for group chats and daily polls
 */
export function setupGroupPollHandler(bot) {
  // When bot is added to a group or its permissions change
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    const newStatus = ctx.myChatMember.new_chat_member.status;

    if (chat.type === 'group' || chat.type === 'supergroup') {
      if (newStatus === 'member' || newStatus === 'administrator') {
        const defaultGroup = groupService.getDefaultGroup() || '562001';
        groupPollService.registerOrUpdateGroupChat({
          chatId: chat.id,
          title: chat.title || 'Чат группы',
          groupNumber: defaultGroup
        });

        await ctx.reply(
          `👋 **Привет, группа ${defaultGroup}!**\n\n` +
          `Я бот для автоматического учёта посещаемости занятий.\n\n` +
          `📊 **Каждое утро в 08:00** я буду отправлять опрос посещаемости:\n` +
          `• 🟢 **Буду** — отметка «Был» на всех парах\n` +
          `• 🟡 **Уваж (УВ)** — 2 часа УВ на каждой паре\n` +
          `• 🔴 **Неуваж (НБ)** — пропуск НБ на парах\n\n` +
          `⚡ **Все ваши ответы автоматически сохраняются в журнал старосты!**\n\n` +
          `_Полезные команды:_\n` +
          `• /poll — Отправить опрос прямо сейчас\n` +
          `• /poll_time \`08:00\` — Изменить время утреннего опроса\n` +
          `• /setgroup \`562001\` — Сменить номер группы для этого чата\n` +
          `• /poll_status — Проверить настройки и результаты`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  });

  // Also when new members join and bot is among them
  bot.on(':new_chat_members', async (ctx, next) => {
    const newMembers = ctx.message.new_chat_members;
    const isBotAdded = newMembers.some(m => m.id === ctx.me.id);

    if (isBotAdded) {
      const defaultGroup = groupService.getDefaultGroup() || '562001';
      groupPollService.registerOrUpdateGroupChat({
        chatId: ctx.chat.id,
        title: ctx.chat.title || 'Чат группы',
        groupNumber: defaultGroup
      });

      await ctx.reply(
        `👋 **Бот подключен к чату группы ${defaultGroup}!**\n` +
        `Отправьте /poll для запуска опроса или /poll_time для настройки расписания.`,
        { parse_mode: 'Markdown' }
      );
    }
    return next();
  });

  // /poll or /опрос command to manually trigger attendance poll
  bot.command(['poll', 'опрос'], async (ctx) => {
    const chat = ctx.chat;
    let grp = groupService.getDefaultGroup() || '562001';

    if (chat.type === 'group' || chat.type === 'supergroup') {
      const chatRecord = groupPollService.getGroupChat(chat.id) ||
                         groupPollService.registerOrUpdateGroupChat({ chatId: chat.id, title: chat.title, groupNumber: grp });
      grp = chatRecord.group_number || grp;
    }

    const todayStr = bsuirApi.toLocalDateString(new Date());
    const [y, m, d] = todayStr.split('-').map(Number);
    const dayDate = new Date(y, m - 1, d, 12, 0, 0);
    const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    const dayName = dayNames[dayDate.getDay()];

    // Fetch lessons for today
    let lessonsInfo = '';
    try {
      const lessons = await attendanceService.syncDayLessons(grp, todayStr);
      if (lessons && lessons.length > 0) {
        const subjNames = [...new Set(lessons.map(l => l.subject))];
        lessonsInfo = ` (${subjNames.join(', ')})`;
      }
    } catch (e) {}

    const pollQuestion = `📊 Посещаемость ${grp} • ${dayName}, ${d}.${String(m).padStart(2, '0')}${lessonsInfo}`.slice(0, 300);

    try {
      const pollMsg = await ctx.replyWithPoll(
        pollQuestion,
        [
          '🟢 Буду',
          '🟡 Уваж (УВ)',
          '🔴 Неуваж (НБ)'
        ],
        {
          is_anonymous: false,
          allows_multiple_answers: false
        }
      );

      groupPollService.saveDailyPoll({
        pollId: pollMsg.poll.id,
        chatId: chat.id,
        groupNumber: grp,
        date: todayStr,
        messageId: pollMsg.message_id
      });

      // Pin the poll if bot is admin
      try {
        await ctx.api.pinChatMessage(chat.id, pollMsg.message_id, { disable_notification: true });
      } catch (e) {}
    } catch (err) {
      console.error('[Send Poll Error]:', err);
      return ctx.reply(`❌ Не удалось отправить опрос: ${err.message}`);
    }
  });

  // /poll_time command: change daily poll time
  bot.command(['poll_time', 'время_опроса'], async (ctx) => {
    const text = ctx.message.text.split(/\s+/)[1];
    if (!text || !/^\d{1,2}:\d{2}$/.test(text)) {
      return ctx.reply('⚠️ Укажите время в формате `ЧЧ:ММ` (например: `/poll_time 08:00`)', { parse_mode: 'Markdown' });
    }

    const [h, m] = text.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return ctx.reply('⚠️ Неверное время. Часы 00-23, минуты 00-59.');
    }

    const formattedTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    groupPollService.registerOrUpdateGroupChat({ chatId: ctx.chat.id, title: ctx.chat.title || '' });
    groupPollService.updateGroupChatSettings(ctx.chat.id, { pollTime: formattedTime, pollEnabled: 1 });

    return ctx.reply(
      `✅ **Время ежедневного опроса установлено на ${formattedTime}** (по Минску).\n\n` +
      `Каждое учебное утро бот будет автоматически публиковать опрос в этот чат!`,
      { parse_mode: 'Markdown' }
    );
  });

  // /setgroup command: change group number for this chat
  bot.command(['setgroup', 'группа'], async (ctx) => {
    const parts = ctx.message.text.split(/\s+/);
    const grp = parts[1];

    if (!grp || !/^\d{6}$/.test(grp)) {
      return ctx.reply('⚠️ Укажите 6-значный номер группы (например: `/setgroup 562001`)', { parse_mode: 'Markdown' });
    }

    groupPollService.registerOrUpdateGroupChat({ chatId: ctx.chat.id, title: ctx.chat.title || '', groupNumber: grp });
    groupPollService.updateGroupChatSettings(ctx.chat.id, { groupNumber: grp });

    await bsuirApi.fetchGroupSchedule(grp).catch(() => {});

    return ctx.reply(
      `✅ **Чат привязан к группе ${grp}!**\n\n` +
      `Расписание и список группы обновлены. Все опросы будут учитываться по этой группе.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /poll_status command
  bot.command(['poll_status', 'статус_опроса'], async (ctx) => {
    const chat = groupPollService.getGroupChat(ctx.chat.id);
    if (!chat) {
      return ctx.reply('ℹ️ Этот чат ещё не зарегистрирован. Отправьте /poll для активации.');
    }

    const todayStr = bsuirApi.toLocalDateString(new Date());
    const todayPoll = groupPollService.getDailyPollForChatAndDate(ctx.chat.id, todayStr);

    return ctx.reply(
      `📊 **Статус опросов группы ${chat.group_number}:**\n\n` +
      `⏰ Время авто-опроса: *${chat.poll_time}*\n` +
      `🔔 Автоопрос включен: *${chat.poll_enabled ? 'Да ✅' : 'Нет ❌'}*\n` +
      `📅 Сегодняшний опрос: *${todayPoll ? 'Отправлен ✅' : 'Ещё не отправлен'}*`,
      { parse_mode: 'Markdown' }
    );
  });

  // /journal command in group chat
  bot.command(['journal', 'журнал'], async (ctx) => {
    return ctx.reply(
      `📱 **Электронный журнал посещаемости:**\n${config.webAppUrl}`,
      { parse_mode: 'Markdown' }
    );
  });

  // Listen to Poll Answer events (when students click an option)
  bot.on('poll_answer', async (ctx) => {
    const { poll_id, user, option_ids } = ctx.pollAnswer;
    const optionId = (option_ids && option_ids.length > 0) ? option_ids[0] : null;

    try {
      const res = await groupPollService.handlePollVote({
        pollId: poll_id,
        user,
        optionId
      });

      if (!res.success) {
        return;
      }

      if (res.matched) {
        console.log(`[Poll Vote] ${res.student.full_name} (${res.student.group_number}) voted option ${optionId} -> status: ${res.status}`);
      } else {
        console.warn(`[Poll Vote Unmatched] User ${user.first_name} (${user.id}) voted in poll ${poll_id}, but student was not found in group ${res.groupNumber}`);
      }
    } catch (err) {
      console.error('[Poll Answer Processing Error]:', err);
    }
  });
}
