import * as groupPollService from './groupPollService.js';
import * as attendanceService from './attendanceService.js';
import * as bsuirApi from './bsuirApi.js';

let intervalId = null;

/**
 * Start the daily automated poll scheduler
 */
export function startPollScheduler(bot) {
  if (!bot) return;

  console.log('⏰ Starting Daily Poll Scheduler service...');

  // Run check every 30 seconds
  intervalId = setInterval(async () => {
    try {
      await checkAndSendDailyPolls(bot);
    } catch (err) {
      console.error('[Poll Scheduler Check Error]:', err.message);
    }
  }, 30000);

  // Run initial check after 5 seconds
  setTimeout(() => {
    checkAndSendDailyPolls(bot).catch(() => {});
  }, 5000);
}

/**
 * Stop scheduler
 */
export function stopPollScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Check active chats and send polls if time matches
 */
export async function checkAndSendDailyPolls(bot) {
  const now = new Date();
  // Format local Minsk time HH:MM (Minsk is UTC+3)
  const m = String(now.getMinutes()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const currentTime = `${h}:${m}`;

  const dayOfWeek = now.getDay();
  // Don't auto-poll on Sunday (0)
  if (dayOfWeek === 0) return;

  const todayStr = bsuirApi.toLocalDateString(now);
  const [year, month, day] = todayStr.split('-').map(Number);
  const dayNames = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const dayName = dayNames[dayOfWeek];

  const activeChats = groupPollService.getAllActiveGroupChats();

  for (const chat of activeChats) {
    if (chat.poll_time !== currentTime) {
      continue;
    }

    // Check if already sent today
    const alreadySent = groupPollService.getDailyPollForChatAndDate(chat.chat_id, todayStr);
    if (alreadySent) {
      continue;
    }

    const grp = chat.group_number || '562001';

    // Fetch lessons for today
    let lessonsInfo = '';
    try {
      const lessons = await attendanceService.syncDayLessons(grp, todayStr);
      if (lessons && lessons.length > 0) {
        const subjNames = [...new Set(lessons.map(l => l.subject))];
        lessonsInfo = ` (${subjNames.join(', ')})`;
      } else {
        // If no lessons today, don't spam poll
        continue;
      }
    } catch (e) {}

    const pollQuestion = `📊 Посещаемость ${grp} • ${dayName}, ${day}.${String(month).padStart(2, '0')}${lessonsInfo}`.slice(0, 300);

    try {
      const pollMsg = await bot.api.sendPoll(
        chat.chat_id,
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
        chatId: chat.chat_id,
        groupNumber: grp,
        date: todayStr,
        messageId: pollMsg.message_id
      });

      console.log(`[Poll Scheduler] Sent daily poll to chat ${chat.chat_id} (${chat.title || grp}) for ${todayStr}`);

      try {
        await bot.api.pinChatMessage(chat.chat_id, pollMsg.message_id, { disable_notification: true });
      } catch (e) {}
    } catch (err) {
      console.error(`[Poll Scheduler Failed for chat ${chat.chat_id}]:`, err.message);
    }
  }
}
