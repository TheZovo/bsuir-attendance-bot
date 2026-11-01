import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let watcherInterval = null;
let lastKnownUrl = null;

function getDataDir() {
  return path.dirname(config.dbPath);
}

function getLogPath() {
  return path.join(getDataDir(), 'cloudflared.log');
}

function getUrlFilePath() {
  return path.join(getDataDir(), 'tunnel_url.txt');
}

/**
 * Extract active trycloudflare URL from log file or cache file
 */
export function findTunnelUrl() {
  const logPath = getLogPath();
  const urlFilePath = getUrlFilePath();

  // 1. Try reading from cloudflared.log
  if (fs.existsSync(logPath)) {
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const matches = [...content.matchAll(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g)];
      if (matches.length > 0) {
        const found = matches[matches.length - 1][0];
        if (found) return found;
      }
    } catch (e) {
      // Ignore read errors
    }
  }

  // 2. Try reading cached tunnel_url.txt
  if (fs.existsSync(urlFilePath)) {
    try {
      const saved = fs.readFileSync(urlFilePath, 'utf8').trim();
      if (saved && saved.startsWith('https://')) {
        return saved;
      }
    } catch (e) {
      // Ignore read errors
    }
  }

  return null;
}

/**
 * Check if the configured WEBAPP_URL is a static custom domain
 */
export function isStaticCustomDomain(url) {
  if (!url) return false;
  if (url === 'auto' || url.includes('localhost') || url.includes('127.0.0.1')) return false;
  if (url.includes('.onrender.com') || url.includes('.koyeb.app') || url.includes('.railway.app')) return true;
  if (url.includes('trycloudflare.com')) return false;
  return url.startsWith('https://');
}

/**
 * Wait for tunnel container to initialize and write its URL
 */
export async function resolveTunnelUrl({ timeoutMs = 15000, intervalMs = 500 } = {}) {
  if (process.env.RENDER_EXTERNAL_URL && (!process.env.WEBAPP_URL || process.env.WEBAPP_URL === 'auto')) {
    const renderUrl = process.env.RENDER_EXTERNAL_URL.startsWith('http') ? process.env.RENDER_EXTERNAL_URL : 'https://' + process.env.RENDER_EXTERNAL_URL;
    console.log('🚀 Detected Render environment URL:', renderUrl);
    lastKnownUrl = renderUrl;
    config.webAppUrl = renderUrl;
    return renderUrl;
  }

  const envUrl = process.env.WEBAPP_URL?.trim();

  // If a fixed custom domain is specified in .env, honor it
  if (envUrl && isStaticCustomDomain(envUrl)) {
    console.log(`🔒 Using fixed custom WEBAPP_URL: ${envUrl}`);
    lastKnownUrl = envUrl;
    return envUrl;
  }

  console.log('⏳ Looking for Cloudflare Tunnel URL in Docker component logs...');
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const url = findTunnelUrl();
    if (url) {
      lastKnownUrl = url;
      config.webAppUrl = url;

      // Save to tunnel_url.txt
      try {
        fs.writeFileSync(getUrlFilePath(), url, 'utf8');
      } catch (e) {}

      console.log(`🌐 Detected active Cloudflare Tunnel URL: ${url}`);
      return url;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // Fallback to configured or local URL
  const fallback = envUrl && envUrl.startsWith('https://') ? envUrl : config.webAppUrl;
  console.warn(`⚠️ Cloudflare tunnel URL not detected within ${timeoutMs / 1000}s. Using fallback: ${fallback}`);
  lastKnownUrl = fallback;
  return fallback;
}

/**
 * Background watcher to re-sync tunnel URL if container restarts or re-tunnels
 */
export function startTunnelWatcher(bot) {
  const envUrl = process.env.WEBAPP_URL?.trim();
  if (envUrl && isStaticCustomDomain(envUrl)) {
    return; // No need to watch if using static domain
  }

  if (watcherInterval) {
    clearInterval(watcherInterval);
  }

  watcherInterval = setInterval(async () => {
    try {
      const currentUrl = findTunnelUrl();
      if (currentUrl && currentUrl !== lastKnownUrl) {
        console.log(`🔄 Tunnel URL changed: ${lastKnownUrl} -> ${currentUrl}`);
        lastKnownUrl = currentUrl;
        config.webAppUrl = currentUrl;

        // Persist
        try {
          fs.writeFileSync(getUrlFilePath(), currentUrl, 'utf8');
        } catch (e) {}

        // Update Telegram Bot menu button if bot is available
        if (bot && bot.api) {
          try {
            await bot.api.setChatMenuButton({
              menu_button: {
                type: 'web_app',
                text: 'Журнал',
                web_app: { url: currentUrl }
              }
            });
            if (config.mainHeadmanId) {
              await bot.api.setChatMenuButton({
                chat_id: config.mainHeadmanId,
                menu_button: {
                  type: 'web_app',
                  text: 'Журнал',
                  web_app: { url: currentUrl }
                }
              }).catch(() => {});
            }
            console.log(`📱 Telegram Chat Menu Button updated to: ${currentUrl}`);
          } catch (err) {
            console.warn('Could not update chat menu button on URL change:', err.message);
          }
        }
      }
    } catch (e) {
      // Ignore background check errors
    }
  }, 3000);
}

export function stopTunnelWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}
