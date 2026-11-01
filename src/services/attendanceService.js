import { db } from '../db/database.js';
import * as bsuirApi from './bsuirApi.js';
import * as groupService from './groupService.js';

/**
 * Determine the official university pair number (1..8) based on start time
 */
export function getPairSlotFromTime(startTime, allDayLessons = []) {
  if (startTime) {
    const parts = startTime.split(':').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const totalMinutes = parts[0] * 60 + parts[1];
      // 1 пара: 08:00 - 09:35 (or 08:30 - 10:00)
      if (totalMinutes < 9 * 60 + 40) return 1;
      // 2 пара: 09:50 - 11:25 (or 10:05 - 11:35)
      if (totalMinutes < 11 * 60 + 35) return 2;
      // 3 пара: 11:45 - 13:20 (or 12:00 - 13:30)
      if (totalMinutes < 13 * 60 + 20) return 3;
      // 4 пара: 13:35 - 15:05 (or 14:00 - 15:35)
      if (totalMinutes < 15 * 60 + 10) return 4;
      // 5 пара: 15:20 - 16:50 (or 15:50 - 17:25)
      if (totalMinutes < 17 * 60) return 5;
      // 6 пара: 17:05 - 18:35 (or 17:40 - 19:15)
      if (totalMinutes < 18 * 60 + 40) return 6;
      // 7 пара: 18:50 - 20:20
      if (totalMinutes < 20 * 60 + 20) return 7;
      // 8 пара: 20:30 - 22:00
      return 8;
    }
  }

  // Fallback to distinct sorted start times of the day
  if (allDayLessons && allDayLessons.length > 0) {
    const times = [...new Set(allDayLessons.map(l => l.startTime || l.start_time))].sort();
    const idx = times.indexOf(startTime);
    if (idx !== -1) return idx + 1;
  }

  return 1;
}

/**
 * Get or create a lesson in the database
 */
export function getOrCreateLesson({
  groupNumber,
  date,
  lessonIndex = 1,
  subject,
  lessonType = 'ПЗ',
  startTime,
  endTime = '',
  subgroup = 0,
  auditory = '',
  source = 'bsuir',
  hours = 2
}) {
  const existing = db.prepare(`
    SELECT * FROM lessons 
    WHERE group_number = ? AND date = ? AND start_time = ? AND subject = ? AND subgroup = ?
  `).get(groupNumber, date, startTime, subject, subgroup);

  if (existing) {
    // If stored lesson_index is outdated or was sequentially indexed, fix it
    if (existing.lesson_index !== lessonIndex) {
      db.prepare('UPDATE lessons SET lesson_index = ? WHERE id = ?').run(lessonIndex, existing.id);
      existing.lesson_index = lessonIndex;
    }
    return existing;
  }

  const stmt = db.prepare(`
    INSERT INTO lessons (group_number, date, lesson_index, subject, lesson_type, start_time, end_time, subgroup, auditory, source, hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(groupNumber, date, lessonIndex, subject, lessonType, startTime, endTime, subgroup, auditory, source, hours);
  return db.prepare('SELECT * FROM lessons WHERE id = ?').get(res.lastInsertRowid);
}

/**
 * Ensure today's lessons from BSUIR schedule exist in DB and return them
 */
export async function syncDayLessons(groupNumber, dateStr) {
  const bsuirLessons = await bsuirApi.getLessonsForDate(groupNumber, dateStr);
  const result = [];

  for (const item of bsuirLessons) {
    const pairSlot = getPairSlotFromTime(item.startTime, bsuirLessons);
    const lesson = getOrCreateLesson({
      groupNumber,
      date: dateStr,
      lessonIndex: pairSlot,
      subject: item.subject,
      lessonType: item.lessonType,
      startTime: item.startTime,
      endTime: item.endTime,
      subgroup: item.subgroup,
      auditory: item.auditory,
      source: 'bsuir',
      hours: 2
    });

    if (lesson.lesson_index !== pairSlot) {
      db.prepare('UPDATE lessons SET lesson_index = ? WHERE id = ?').run(pairSlot, lesson.id);
      lesson.lesson_index = pairSlot;
    }

    result.push({
      ...lesson,
      lesson_index: pairSlot,
      pairNumber: pairSlot,
      subjectFullName: item.subjectFullName,
      teacher: item.teacher
    });
  }

  // Also query any custom lessons created manually for this date
  const manualLessons = db.prepare(`
    SELECT * FROM lessons 
    WHERE group_number = ? AND date = ? AND source = 'manual'
    ORDER BY start_time ASC
  `).all(groupNumber, dateStr);

  return [...result, ...manualLessons];
}

/**
 * Set single student's attendance on a lesson
 * Status: 'present' (Был), 'absent' (НБ), 'valid_reason' (УВ), 'late' (Опоздал)
 */
export function setAttendance({ lessonId, studentId, status, note = null, markedBy = null }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO attendance (lesson_id, student_id, status, note, updated_at, marked_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(lesson_id, student_id) DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      updated_at = excluded.updated_at,
      marked_by = excluded.marked_by
  `);
  stmt.run(lessonId, studentId, status, note ?? null, now, markedBy ?? null);

  return db.prepare('SELECT * FROM attendance WHERE lesson_id = ? AND student_id = ?').get(lessonId, studentId);
}

/**
 * Get attendance records for a specific lesson
 */
export function getLessonAttendance(lessonId) {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) return null;

  const students = groupService.getStudents(lesson.group_number, lesson.subgroup);
  const marks = db.prepare('SELECT * FROM attendance WHERE lesson_id = ?').all(lessonId);
  const markMap = new Map(marks.map(m => [m.student_id, m]));

  const records = students.map(student => {
    const m = markMap.get(student.id);
    return {
      studentId: student.id,
      fullName: student.full_name,
      subgroup: student.subgroup,
      telegramId: student.telegram_id,
      status: m ? m.status : 'present', // default present
      isMarked: !!m,
      note: m ? m.note : null,
      updatedAt: m ? m.updated_at : null
    };
  });

  return {
    lesson,
    students: records
  };
}

/**
 * Batch mark attendance for a lesson
 */
export function batchSaveAttendance(lessonId, attendanceList, markedBy = null) {
  // attendanceList = [{ studentId, status, note }]
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO attendance (lesson_id, student_id, status, note, updated_at, marked_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(lesson_id, student_id) DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      updated_at = excluded.updated_at,
      marked_by = excluded.marked_by
  `);

  for (const item of attendanceList) {
    stmt.run(lessonId, item.studentId, item.status, item.note ?? null, now, markedBy ?? null);
  }

  return getLessonAttendance(lessonId);
}

/**
 * Mark all students present for a lesson
 */
export function markAllPresent(lessonId, markedBy = null) {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) return null;

  const students = groupService.getStudents(lesson.group_number, lesson.subgroup);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO attendance (lesson_id, student_id, status, updated_at, marked_by)
    VALUES (?, ?, 'present', ?, ?)
    ON CONFLICT(lesson_id, student_id) DO UPDATE SET
      status = 'present',
      updated_at = excluded.updated_at,
      marked_by = excluded.marked_by
  `);

  for (const s of students) {
    stmt.run(lessonId, s.id, now, markedBy ?? null);
  }

  return getLessonAttendance(lessonId);
}

/**
 * Get attendance statistics for an individual student
 */
export function getStudentStats(studentId) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) return null;

  // Absences (absent = НБ, valid_reason = УВ)
  const rows = db.prepare(`
    SELECT a.*, l.date, l.subject, l.lesson_type, l.start_time, l.hours
    FROM attendance a
    JOIN lessons l ON a.lesson_id = l.id
    WHERE a.student_id = ?
    ORDER BY l.date DESC, l.start_time DESC
  `).all(studentId);

  let totalNbHours = 0;
  let totalUvHours = 0;
  let totalPresentCount = 0;
  let totalLateCount = 0;

  const subjectStatsMap = new Map();

  for (const r of rows) {
    const hours = r.hours || 2;
    const subKey = `${r.subject} (${r.lesson_type})`;

    if (!subjectStatsMap.has(subKey)) {
      subjectStatsMap.set(subKey, {
        subject: r.subject,
        lessonType: r.lesson_type,
        nbHours: 0,
        uvHours: 0,
        totalMissedHours: 0
      });
    }

    const subStat = subjectStatsMap.get(subKey);

    if (r.status === 'absent') {
      totalNbHours += hours;
      subStat.nbHours += hours;
      subStat.totalMissedHours += hours;
    } else if (r.status === 'valid_reason') {
      totalUvHours += hours;
      subStat.uvHours += hours;
      subStat.totalMissedHours += hours;
    } else if (r.status === 'late') {
      totalLateCount++;
    } else if (r.status === 'present') {
      totalPresentCount++;
    }
  }

  const totalMissedHours = totalNbHours + totalUvHours;
  const history = rows.filter(r => r.status !== 'present');

  return {
    student,
    summary: {
      totalMissedHours,
      totalNbHours,
      totalUvHours,
      totalLateCount,
      totalPresentCount
    },
    bySubject: Array.from(subjectStatsMap.values()).filter(s => s.totalMissedHours > 0),
    history
  };
}

/**
 * Get full group attendance matrix (for Mini App table)
 */
export function getGroupGrid(groupNumber, limitDays = 30) {
  const students = groupService.getStudents(groupNumber);

  // Get distinct recent lessons
  const lessons = db.prepare(`
    SELECT * FROM lessons 
    WHERE group_number = ?
    ORDER BY date DESC, start_time DESC
    LIMIT ?
  `).all(groupNumber, limitDays * 5);

  // Sort lessons ascending for column order
  lessons.reverse();

  // Load all attendance marks for these lessons
  const lessonIds = lessons.map(l => l.id);
  const marksMap = {}; // `${studentId}_${lessonId}` -> mark

  if (lessonIds.length > 0) {
    const placeholders = lessonIds.map(() => '?').join(',');
    const marks = db.prepare(`
      SELECT * FROM attendance 
      WHERE lesson_id IN (${placeholders})
    `).all(...lessonIds);

    for (const m of marks) {
      marksMap[`${m.student_id}_${m.lesson_id}`] = m;
    }
  }

  // Calculate per-student totals across all time
  const studentTotals = db.prepare(`
    SELECT 
      a.student_id,
      SUM(CASE WHEN a.status = 'absent' THEN l.hours ELSE 0 END) AS nb_hours,
      SUM(CASE WHEN a.status = 'valid_reason' THEN l.hours ELSE 0 END) AS uv_hours
    FROM attendance a
    JOIN lessons l ON a.lesson_id = l.id
    WHERE l.group_number = ?
    GROUP BY a.student_id
  `).all(groupNumber);

  const totalsMap = new Map(studentTotals.map(t => [t.student_id, {
    nb: t.nb_hours || 0,
    uv: t.uv_hours || 0,
    total: (t.nb_hours || 0) + (t.uv_hours || 0)
  }]));

  const enrichedStudents = students.map(s => {
    const tot = totalsMap.get(s.id) || { nb: 0, uv: 0, total: 0 };
    return {
      id: s.id,
      fullName: s.full_name,
      subgroup: s.subgroup,
      telegramId: s.telegram_id,
      nbHours: tot.nb,
      uvHours: tot.uv,
      totalHours: tot.total
    };
  });

  return {
    groupNumber,
    students: enrichedStudents,
    lessons: lessons.map(l => ({
      id: l.id,
      date: l.date,
      subject: l.subject,
      lessonType: l.lesson_type,
      startTime: l.start_time,
      endTime: l.end_time,
      subgroup: l.subgroup,
      hours: l.hours
    })),
    marks: marksMap
  };
}

/**
 * Get group attendance overall summary
 */
export function getGroupSummary(groupNumber) {
  const students = groupService.getStudents(groupNumber);
  const grid = getGroupGrid(groupNumber);

  // Sort students by absences descending (top absentees)
  const sortedStudents = [...grid.students].sort((a, b) => b.totalHours - a.totalHours);

  const totalNb = sortedStudents.reduce((acc, s) => acc + s.nbHours, 0);
  const totalUv = sortedStudents.reduce((acc, s) => acc + s.uvHours, 0);

  return {
    groupNumber,
    studentCount: students.length,
    totalNbHours: totalNb,
    totalUvHours: totalUv,
    totalMissedHours: totalNb + totalUv,
    topAbsentees: sortedStudents.slice(0, 5)
  };
}

/**
 * Register valid reason (ОРВИ / Справка / Заявление) and automatically mark UV on all lessons in dates
 */
export async function submitValidReason({ studentId, telegramId = null, reasonType = 'ОРВИ', startDate, endDate, note = '' }) {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);
  if (!student) {
    throw new Error('Студент не найден в базе группы');
  }

  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO valid_reasons (student_id, telegram_id, reason_type, start_date, end_date, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(studentId, telegramId ?? null, reasonType, startDate, endDate, note ?? null, now);
  const record = db.prepare('SELECT * FROM valid_reasons WHERE id = ?').get(res.lastInsertRowid);

  // Iterate dates from startDate to endDate safely
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  let current = new Date(sy, sm - 1, sd, 12, 0, 0);
  const end = new Date(ey, em - 1, ed, 12, 0, 0);

  let markedLessonsCount = 0;

  while (current <= end) {
    const dateStr = bsuirApi.toLocalDateString(current);
    try {
      // Sync or fetch lessons for this date from BSUIR API
      const dayLessons = await syncDayLessons(student.group_number, dateStr);

      for (const lesson of dayLessons) {
        // Skip if lesson is for another subgroup
        if (lesson.subgroup !== 0 && student.subgroup !== 0 && lesson.subgroup !== student.subgroup) {
          continue;
        }

        // Auto mark as valid_reason (УВ, 2 hours)
        setAttendance({
          lessonId: lesson.id,
          studentId: student.id,
          status: 'valid_reason',
          note: `${reasonType}: ${note || ''}`.trim(),
          markedBy: telegramId
        });
        markedLessonsCount++;
      }
    } catch (e) {
      console.warn(`Could not sync day ${dateStr} for valid reason:`, e.message);
    }

    current.setDate(current.getDate() + 1);
  }

  return {
    success: true,
    record,
    student,
    markedLessonsCount,
    markedHours: markedLessonsCount * 2
  };
}

/**
 * Get all valid reasons registered for a student
 */
export function getStudentValidReasons(studentId) {
  return db.prepare('SELECT * FROM valid_reasons WHERE student_id = ? ORDER BY id DESC').all(studentId);
}

