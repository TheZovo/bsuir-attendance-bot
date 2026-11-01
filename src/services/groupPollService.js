import { db } from '../db/database.js';
import * as attendanceService from './attendanceService.js';
import * as groupService from './groupService.js';
import * as bsuirApi from './bsuirApi.js';

/**
 * Register or update a group chat in SQLite
 */
export function registerOrUpdateGroupChat({ chatId, title = '', groupNumber = '562001' }) {
  const existing = db.prepare('SELECT * FROM group_chats WHERE chat_id = ?').get(chatId);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE group_chats 
      SET title = COALESCE(?, title),
          group_number = COALESCE(?, group_number)
      WHERE chat_id = ?
    `).run(title || null, groupNumber || null, chatId);
    return db.prepare('SELECT * FROM group_chats WHERE chat_id = ?').get(chatId);
  }

  db.prepare(`
    INSERT INTO group_chats (chat_id, title, group_number, poll_enabled, poll_time, created_at)
    VALUES (?, ?, ?, 1, '08:00', ?)
  `).run(chatId, title, groupNumber, now);

  return db.prepare('SELECT * FROM group_chats WHERE chat_id = ?').get(chatId);
}

/**
 * Get group chat by chatId
 */
export function getGroupChat(chatId) {
  return db.prepare('SELECT * FROM group_chats WHERE chat_id = ?').get(chatId);
}

/**
 * Get all active group chats for automated polling
 */
export function getAllActiveGroupChats() {
  return db.prepare('SELECT * FROM group_chats WHERE poll_enabled = 1').all();
}

/**
 * Update chat settings
 */
export function updateGroupChatSettings(chatId, { groupNumber, pollEnabled, pollTime }) {
  const current = getGroupChat(chatId);
  if (!current) return null;

  const targetGroup = groupNumber !== undefined ? groupNumber : current.group_number;
  const targetEnabled = pollEnabled !== undefined ? (pollEnabled ? 1 : 0) : current.poll_enabled;
  const targetTime = pollTime !== undefined ? pollTime : current.poll_time;

  db.prepare(`
    UPDATE group_chats 
    SET group_number = ?, poll_enabled = ?, poll_time = ?
    WHERE chat_id = ?
  `).run(targetGroup, targetEnabled, targetTime, chatId);

  return getGroupChat(chatId);
}

/**
 * Save daily poll record
 */
export function saveDailyPoll({ pollId, chatId, groupNumber, date, messageId = null }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO daily_polls (poll_id, chat_id, group_number, date, message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(pollId, chatId, groupNumber, date, messageId, now);

  return db.prepare('SELECT * FROM daily_polls WHERE poll_id = ?').get(pollId);
}

/**
 * Find daily poll by pollId
 */
export function getDailyPoll(pollId) {
  return db.prepare('SELECT * FROM daily_polls WHERE poll_id = ?').get(pollId);
}

/**
 * Check if a poll was already created for this chat on this date
 */
export function getDailyPollForChatAndDate(chatId, date) {
  return db.prepare('SELECT * FROM daily_polls WHERE chat_id = ? AND date = ?').get(chatId, date);
}

/**
 * Find student associated with Telegram user
 */
export function findStudentForPollUser(groupNumber, user) {
  const telegramId = user.id;

  // 1. Direct match by telegram_id in students table
  let student = db.prepare('SELECT * FROM students WHERE group_number = ? AND telegram_id = ?').get(groupNumber, telegramId);
  if (student) return student;

  // 2. Match via users table
  const userRecord = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (userRecord && userRecord.student_id) {
    student = db.prepare('SELECT * FROM students WHERE id = ?').get(userRecord.student_id);
    if (student) {
      if (!student.telegram_id) {
        db.prepare('UPDATE students SET telegram_id = ? WHERE id = ?').run(telegramId, student.id);
      }
      return student;
    }
  }

  // 3. Match by name
  const allGroupStudents = groupService.getStudents(groupNumber);
  const firstName = (user.first_name || '').trim().toLowerCase();
  const lastName = (user.last_name || '').trim().toLowerCase();
  const username = (user.username || '').trim().toLowerCase();

  // Try matching last name first (since Belarusian/Russian names usually start with surname)
  if (lastName) {
    const byLast = allGroupStudents.find(s => {
      const parts = s.full_name.toLowerCase().split(/\s+/);
      return parts.includes(lastName) || parts[0] === lastName;
    });
    if (byLast) {
      db.prepare('UPDATE students SET telegram_id = ? WHERE id = ?').run(telegramId, byLast.id);
      return byLast;
    }
  }

  // Try matching full name
  if (firstName) {
    const byFirst = allGroupStudents.find(s => {
      const parts = s.full_name.toLowerCase().split(/\s+/);
      return parts.includes(firstName);
    });
    if (byFirst) {
      db.prepare('UPDATE students SET telegram_id = ? WHERE id = ?').run(telegramId, byFirst.id);
      return byFirst;
    }
  }

  return null;
}

/**
 * Handle student vote in Telegram poll
 */
export async function handlePollVote({ pollId, user, optionId }) {
  const poll = getDailyPoll(pollId);
  if (!poll) {
    return { success: false, error: 'Опрос не найден в базе данных' };
  }

  const { group_number: groupNumber, date } = poll;
  const student = findStudentForPollUser(groupNumber, user);

  // If optionId is undefined or null (vote retracted)
  if (optionId === undefined || optionId === null) {
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND telegram_id = ?').run(pollId, user.id);
    return { success: true, retracted: true };
  }

  // Save vote
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO poll_votes (poll_id, telegram_id, student_id, vote_option, voted_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(poll_id, telegram_id) DO UPDATE SET
      vote_option = excluded.vote_option,
      voted_at = excluded.voted_at,
      student_id = COALESCE(excluded.student_id, poll_votes.student_id)
  `).run(pollId, user.id, student ? student.id : null, optionId, now);

  if (!student) {
    return {
      success: true,
      matched: false,
      user,
      groupNumber,
      optionId
    };
  }

  // Map option: 0: Буду, 1: Уваж (УВ), 2: Неуваж (НБ)
  let status = 'present';
  let note = 'Опрос в чате: Буду';

  if (optionId === 1) {
    status = 'valid_reason';
    note = 'Опрос в чате: Уважительная причина';
  } else if (optionId === 2) {
    status = 'absent';
    note = 'Опрос в чате: Неуважительная причина';
  }

  // Sync day lessons
  const lessons = await attendanceService.syncDayLessons(groupNumber, date);
  let markedCount = 0;

  for (const lesson of lessons) {
    if (lesson.subgroup !== 0 && student.subgroup !== 0 && lesson.subgroup !== student.subgroup) {
      continue;
    }

    attendanceService.setAttendance({
      lessonId: lesson.id,
      studentId: student.id,
      status,
      note,
      markedBy: user.id
    });
    markedCount++;
  }

  return {
    success: true,
    matched: true,
    student,
    status,
    note,
    lessonsCount: markedCount,
    date
  };
}
