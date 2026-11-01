import { Bot } from 'grammy';
import { config } from '../config.js';
import { setupStartHandler } from './handlers/start.js';
import { setupAttendanceHandler } from './handlers/attendance.js';
import { setupScheduleHandler } from './handlers/schedule.js';
import { setupAdminHandler } from './handlers/admin.js';
import { setupGroupPollHandler } from './handlers/groupPoll.js';

export function createBot() {
  if (!config.botToken) {
    console.warn('[Bot] No BOT_TOKEN set in .env. Bot polling will not start, but Mini App web server is running!');
    return null;
  }

  const bot = new Bot(config.botToken);

  // Register command handlers
  setupStartHandler(bot);
  setupAttendanceHandler(bot);
  setupScheduleHandler(bot);
  setupAdminHandler(bot);
  setupGroupPollHandler(bot);

  // Catch unhandled errors gracefully
  bot.catch((err) => {
    console.error(`[Bot Error in update ${err.ctx.update.update_id}]:`, err.error);
  });

  return bot;
}
