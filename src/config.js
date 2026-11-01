import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  botToken: process.env.BOT_TOKEN || '',
  webAppUrl: process.env.WEBAPP_URL || 'http://localhost:3000',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'attendance.sqlite'),
  defaultGroup: process.env.DEFAULT_GROUP || '',
  bsuirApiBase: process.env.BSUIR_API_BASE || 'https://iis.bsuir.by/api/v1',
  mainHeadmanId: parseInt(process.env.MAIN_HEADMAN_ID || '6567758362', 10),
  isDev: process.env.NODE_ENV !== 'production'
};
