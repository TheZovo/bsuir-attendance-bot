import { db } from '../db/database.js';
import { config } from '../config.js';

/**
 * Check if a user is the primary headman
 */
export function isMainHeadman(telegramId) {
  return Number(telegramId) === config.mainHeadmanId;
}

/**
 * Get user by Telegram ID
 */
export function getUser(telegramId) {
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (user && isMainHeadman(telegramId) && user.role !== 'headman') {
    db.prepare("UPDATE users SET role = 'headman' WHERE telegram_id = ?").run(telegramId);
    user.role = 'headman';
  }
  return user;
}

/**
 * Register or update Telegram user
 */
export function saveUser({ telegramId, firstName, lastName, username, groupNumber, role = 'student', studentId = null }) {
  const existing = getUser(telegramId);
  const now = new Date().toISOString();
  
  // Enforce primary headman role
  const effectiveRole = isMainHeadman(telegramId) ? 'headman' : (existing ? existing.role : role);

  if (existing) {
    const stmt = db.prepare(`
      UPDATE users SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        username = COALESCE(?, username),
        group_number = COALESCE(?, group_number),
        role = COALESCE(?, role),
        student_id = COALESCE(?, student_id)
      WHERE telegram_id = ?
    `);
    stmt.run(
      firstName ?? null,
      lastName ?? null,
      username ?? null,
      groupNumber ?? null,
      effectiveRole ?? null,
      studentId ?? null,
      telegramId
    );
    return getUser(telegramId);
  } else {
    const stmt = db.prepare(`
      INSERT INTO users (telegram_id, first_name, last_name, username, group_number, role, student_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      telegramId,
      firstName ?? null,
      lastName ?? null,
      username ?? null,
      groupNumber ?? null,
      effectiveRole,
      studentId ?? null,
      now
    );
    return getUser(telegramId);
  }
}

/**
 * Update user role
 */
export function setUserRole(telegramId, role) {
  // Main headman cannot be demoted
  if (isMainHeadman(telegramId)) {
    role = 'headman';
  }
  db.prepare('UPDATE users SET role = ? WHERE telegram_id = ?').run(role, telegramId);
}

/**
 * Create request to become a deputy headman / headman
 */
export function createHeadmanRequest({ telegramId, firstName, username, groupNumber }) {
  const existing = db.prepare(`
    SELECT * FROM headman_requests 
    WHERE telegram_id = ? AND status = 'pending'
  `).get(telegramId);

  if (existing) return existing;

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO headman_requests (telegram_id, first_name, username, group_number, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `);
  const res = stmt.run(telegramId, firstName ?? null, username ?? null, groupNumber, now);
  return db.prepare('SELECT * FROM headman_requests WHERE id = ?').get(res.lastInsertRowid);
}

/**
 * Resolve headman request (approve or reject)
 */
export function resolveHeadmanRequest(requestId, approved = true) {
  const status = approved ? 'approved' : 'rejected';
  db.prepare('UPDATE headman_requests SET status = ? WHERE id = ?').run(status, requestId);
  const req = db.prepare('SELECT * FROM headman_requests WHERE id = ?').get(requestId);
  if (req && approved) {
    setUserRole(req.telegram_id, 'deputy');
  }
  return req;
}

/**
 * Get all pending headman requests
 */
export function getPendingHeadmanRequests() {
  return db.prepare("SELECT * FROM headman_requests WHERE status = 'pending' ORDER BY id DESC").all();
}

/**
 * Update user's linked student ID
 */
export function linkUserToStudent(telegramId, studentId) {
  db.prepare('UPDATE users SET student_id = ? WHERE telegram_id = ?').run(studentId, telegramId);
  if (studentId) {
    db.prepare('UPDATE students SET telegram_id = ? WHERE id = ?').run(telegramId, studentId);
  }
}

/**
 * Set default group in settings
 */
export function setDefaultGroup(groupNumber) {
  db.prepare(`
    INSERT INTO settings (key, value)
    VALUES ('default_group', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(groupNumber);
}

/**
 * Get default group
 */
export function getDefaultGroup() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_group'").get();
  return row ? row.value : null;
}

/**
 * Get all students for a group
 */
export function getStudents(groupNumber, subgroup = null) {
  if (subgroup !== null && subgroup !== 0) {
    return db.prepare(`
      SELECT * FROM students 
      WHERE group_number = ? AND is_active = 1 AND (subgroup = 0 OR subgroup = ?)
      ORDER BY full_name ASC
    `).all(groupNumber, subgroup);
  }
  return db.prepare(`
    SELECT * FROM students 
    WHERE group_number = ? AND is_active = 1 
    ORDER BY full_name ASC
  `).all(groupNumber);
}

/**
 * Add a student
 */
export function addStudent(groupNumber, fullName, subgroup = 0, telegramId = null) {
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  const stmt = db.prepare(`
    INSERT INTO students (group_number, full_name, subgroup, telegram_id, is_active)
    VALUES (?, ?, ?, ?, 1)
  `);
  const result = stmt.run(groupNumber, trimmed, subgroup ?? 0, telegramId ?? null);
  return db.prepare('SELECT * FROM students WHERE id = ?').get(result.lastInsertRowid);
}

/**
 * Bulk add students from multiline text (with optional subgroup detection)
 */
export function bulkAddStudents(groupNumber, textList) {
  const rawLines = textList.split(/[\r\n]+/)
    .map(line => line.trim())
    .filter(line => line.length > 2);

  const stmt = db.prepare(`
    INSERT INTO students (group_number, full_name, subgroup, is_active)
    VALUES (?, ?, ?, 1)
  `);

  let addedCount = 0;
  for (const rawLine of rawLines) {
    let line = rawLine.replace(/^[\d\s.)\-]+/, '').trim();
    let subgroup = 0;

    // Detect subgroup like: (1), (2), [1], (1 подгруппа), 1 пг, | 1
    const subMatch = line.match(/(?:\(|\[|\b)(\d)\s*(?:подгруппа|пг|п\/г)?(?:\)|\]|\b)?$/i);
    if (subMatch && (subMatch[1] === '1' || subMatch[1] === '2')) {
      subgroup = parseInt(subMatch[1], 10);
      line = line.replace(/(?:\(|\[|\b)\d\s*(?:подгруппа|пг|п\/г)?(?:\)|\]|\b)?$/i, '').trim();
    }

    if (line.length < 2) continue;

    // Check if duplicate in same group
    const exists = db.prepare('SELECT id FROM students WHERE group_number = ? AND LOWER(full_name) = LOWER(?)').get(groupNumber, line);
    if (!exists) {
      stmt.run(groupNumber, line, subgroup);
      addedCount++;
    }
  }

  return { addedCount, totalParsed: rawLines.length };
}

/**
 * Clear all unlinked students from group
 */
export function clearGroupStudents(groupNumber, keepTelegramLinked = true) {
  if (keepTelegramLinked) {
    const res = db.prepare('DELETE FROM students WHERE group_number = ? AND telegram_id IS NULL').run(groupNumber);
    return res.changes;
  }
  const res = db.prepare('DELETE FROM students WHERE group_number = ?').run(groupNumber);
  return res.changes;
}

/**
 * Delete or deactivate student
 */
export function deleteStudent(studentId) {
  db.prepare('DELETE FROM students WHERE id = ?').run(studentId);
}

/**
 * Update student's subgroup (0 = all/none, 1 = 1st, 2 = 2nd)
 */
export function updateStudentSubgroup(studentId, subgroup) {
  const sub = parseInt(subgroup, 10);
  const validSub = (sub === 1 || sub === 2) ? sub : 0;
  db.prepare('UPDATE students SET subgroup = ? WHERE id = ?').run(validSub, studentId);
  return db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
}

/**
 * Find student by Telegram ID
 */
export function findStudentByTelegram(telegramId) {
  return db.prepare('SELECT * FROM students WHERE telegram_id = ?').get(telegramId);
}

/**
 * Get group metadata
 */
export function getGroupMeta(groupNumber) {
  return db.prepare('SELECT * FROM groups WHERE group_number = ?').get(groupNumber);
}

/**
 * Add custom subject
 */
export function addCustomSubject(groupNumber, { name, fullName = '', lessonType = 'ПЗ', teacher = '', subgroup = 0 }) {
  const stmt = db.prepare(`
    INSERT INTO custom_subjects (group_number, name, full_name, lesson_type, teacher, subgroup)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(groupNumber, name, fullName, lessonType, teacher, subgroup);
}

/**
 * Get custom subjects for group
 */
export function getCustomSubjects(groupNumber) {
  return db.prepare('SELECT * FROM custom_subjects WHERE group_number = ?').all(groupNumber);
}

/**
 * Find student by student card number
 */
export function findStudentByCard(studentCard) {
  if (!studentCard) return null;
  return db.prepare('SELECT * FROM students WHERE student_card = ?').get(studentCard.trim());
}

/**
 * Automatically link an existing student or create a new student profile with student card / IIS data
 */
export function linkOrRegisterStudent({ groupNumber, fullName, studentCard = null, telegramId = null, subgroup = 0 }) {
  let student = null;

  // 1. Try finding by student card
  if (studentCard) {
    student = findStudentByCard(studentCard);
  }

  // 2. Try finding by matching full name in the same group
  if (!student && fullName) {
    student = db.prepare(`
      SELECT * FROM students 
      WHERE group_number = ? AND LOWER(full_name) = LOWER(?)
    `).get(groupNumber, fullName.trim());
  }

  if (student) {
    // Update existing student with telegramId and studentCard
    db.prepare(`
      UPDATE students SET 
        telegram_id = COALESCE(?, telegram_id),
        student_card = COALESCE(?, student_card)
      WHERE id = ?
    `).run(telegramId ?? null, studentCard ?? null, student.id);
  } else {
    // Create new student
    const stmt = db.prepare(`
      INSERT INTO students (group_number, full_name, subgroup, student_card, telegram_id, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    const res = stmt.run(groupNumber, fullName.trim(), subgroup, studentCard ?? null, telegramId ?? null);
    student = db.prepare('SELECT * FROM students WHERE id = ?').get(res.lastInsertRowid);
  }

  // Link to user if telegramId provided
  if (telegramId) {
    linkUserToStudent(telegramId, student.id);
    db.prepare(`
      UPDATE users SET 
        group_number = ?,
        student_card = COALESCE(?, student_card)
      WHERE telegram_id = ?
    `).run(groupNumber, studentCard ?? null, telegramId);
  }

  return student;
}

