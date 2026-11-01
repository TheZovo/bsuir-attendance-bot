import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Ensure directory exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new DatabaseSync(config.dbPath);

// Initialize database schema
export function initDb() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS groups (
      group_number TEXT PRIMARY KEY,
      faculty TEXT,
      course INTEGER,
      speciality TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      telegram_id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      group_number TEXT,
      role TEXT DEFAULT 'student',
      student_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_number TEXT NOT NULL,
      full_name TEXT NOT NULL,
      subgroup INTEGER DEFAULT 0,
      telegram_id INTEGER,
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS custom_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_number TEXT NOT NULL,
      name TEXT NOT NULL,
      full_name TEXT,
      lesson_type TEXT DEFAULT 'ПЗ',
      teacher TEXT,
      subgroup INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_number TEXT NOT NULL,
      date TEXT NOT NULL,
      lesson_index INTEGER DEFAULT 1,
      subject TEXT NOT NULL,
      lesson_type TEXT DEFAULT 'ПЗ',
      start_time TEXT NOT NULL,
      end_time TEXT,
      subgroup INTEGER DEFAULT 0,
      auditory TEXT,
      source TEXT DEFAULT 'bsuir',
      hours INTEGER DEFAULT 2,
      UNIQUE(group_number, date, start_time, subject, subgroup)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      status TEXT NOT NULL, -- 'present', 'absent', 'valid_reason', 'late'
      note TEXT,
      updated_at TEXT,
      marked_by INTEGER,
      UNIQUE(lesson_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS schedule_cache (
      group_number TEXT PRIMARY KEY,
      data_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS headman_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL,
      first_name TEXT,
      username TEXT,
      group_number TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS valid_reasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      telegram_id INTEGER,
      reason_type TEXT NOT NULL, -- 'ОРВИ', 'Справка', 'Заявление', 'Соревнования'
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      note TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS group_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER UNIQUE NOT NULL,
      title TEXT,
      group_number TEXT NOT NULL DEFAULT '562001',
      poll_enabled INTEGER DEFAULT 1,
      poll_time TEXT DEFAULT '08:00',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id TEXT UNIQUE NOT NULL,
      chat_id INTEGER NOT NULL,
      group_number TEXT NOT NULL,
      date TEXT NOT NULL,
      message_id INTEGER,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id TEXT NOT NULL,
      telegram_id INTEGER NOT NULL,
      student_id INTEGER,
      vote_option INTEGER NOT NULL,
      voted_at TEXT,
      UNIQUE(poll_id, telegram_id)
    );
  `);

  // Safe migrations for optional columns
  try {
    db.exec(`ALTER TABLE students ADD COLUMN student_card TEXT;`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN student_card TEXT;`);
  } catch (e) {}
}
