import { config } from './config.js';
import { initDb } from './db/database.js';
import { createServer } from './server/app.js';
import { createBot } from './bot/bot.js';
import { startPollScheduler, stopPollScheduler } from './services/pollScheduler.js';
import { resolveTunnelUrl, startTunnelWatcher, stopTunnelWatcher } from './services/tunnelService.js';
import * as groupService from './services/groupService.js';
import * as bsuirApi from './services/bsuirApi.js';
import * as attendanceService from './services/attendanceService.js';

async function bootstrap() {
  console.log('🚀 Initializing BSUIR Attendance System...');

  // 1. Initialize SQLite Database
  initDb();
  console.log('💾 Database initialized at:', config.dbPath);

  // 2. Setup default group if not configured
  const defaultGroup = config.defaultGroup || groupService.getDefaultGroup() || '562001';
  groupService.setDefaultGroup(defaultGroup);

  // 3. Pre-cache schedule from BSUIR API in background
  try {
    console.log(`🌐 Syncing schedule from IIS BSUIR API for group ${defaultGroup}...`);
    await bsuirApi.fetchGroupSchedule(defaultGroup);
    const todayStr = new Date().toISOString().split('T')[0];
    await attendanceService.syncDayLessons(defaultGroup, todayStr);
    console.log(`✅ Schedule synced successfully!`);
  } catch (err) {
    console.warn(`⚠️ Could not pre-fetch BSUIR schedule (will retry when requested):`, err.message);
  }

  // 4. Resolve Cloudflare Tunnel URL (from Docker tunnel component or config)
  try {
    await resolveTunnelUrl({ timeoutMs: 12000 });
  } catch (err) {
    console.warn('⚠️ Tunnel URL resolution note:', err.message);
  }

  // 5. Start Express Web Server (Mini App & API)
  const app = createServer();
  const server = app.listen(config.port, () => {
    console.log(`🌐 Telegram Mini App & API server running on: http://localhost:${config.port}`);
    console.log(`📱 Mini App URL for Telegram: ${config.webAppUrl}`);
  });

  // 6. Start Telegram Bot if BOT_TOKEN is set
  const bot = createBot();
  if (bot) {
    console.log('🤖 Starting Telegram Bot polling...');
    bot.start({
      onStart: async (botInfo) => {
        console.log(`✅ Telegram Bot @${botInfo.username} is running!`);
        if (config.webAppUrl && config.webAppUrl.startsWith('https://')) {
          try {
            await bot.api.setChatMenuButton({
              menu_button: {
                type: 'web_app',
                text: 'Журнал',
                web_app: { url: config.webAppUrl }
              }
            });
            if (config.mainHeadmanId) {
              await bot.api.setChatMenuButton({
                chat_id: config.mainHeadmanId,
                menu_button: {
                  type: 'web_app',
                  text: 'Журнал',
                  web_app: { url: config.webAppUrl }
                }
              }).catch(() => {});
            }
            console.log(`📱 Telegram Menu Button set to: ${config.webAppUrl}`);
          } catch (e) {
            console.warn('Could not set chat menu button automatically:', e.message);
          }
        }
        startPollScheduler(bot);
        startTunnelWatcher(bot);
      }
    });
  } else {
    console.log('ℹ️ Bot token not set. To activate Telegram bot, specify BOT_TOKEN in .env file.');
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down gracefully...');
    stopTunnelWatcher();
    stopPollScheduler();
    if (bot) bot.stop();
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
