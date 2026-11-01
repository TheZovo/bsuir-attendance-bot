import { config } from '../config.js';
import { db } from '../db/database.js';

const DAYS_OF_WEEK = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота'
];

/**
 * Fetch with timeout helper
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch current academic week (1..4) from IIS BSUIR
 */
export async function fetchCurrentWeek() {
  try {
    const res = await fetchWithTimeout(`${config.bsuirApiBase}/schedule/current-week`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const text = await res.text();
    const week = parseInt(text.trim(), 10);
    return isNaN(week) ? 1 : week;
  } catch (err) {
    console.warn('[BSUIR API] Failed to fetch current week, defaulting to 1:', err.message);
    return 1;
  }
}

/**
 * Fetch all student groups from IIS BSUIR
 */
export async function fetchStudentGroups() {
  try {
    const res = await fetchWithTimeout(`${config.bsuirApiBase}/student-groups`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('[BSUIR API] Failed to fetch student groups:', err.message);
    return [];
  }
}

/**
 * Fetch schedule directly from IIS BSUIR API and save to cache
 */
export async function fetchGroupSchedule(groupNumber) {
  try {
    const url = `${config.bsuirApiBase}/schedule?studentGroup=${encodeURIComponent(groupNumber)}`;
    const res = await fetchWithTimeout(url, {}, 12000);
    if (!res.ok) {
      throw new Error(`Schedule endpoint returned status ${res.status}`);
    }
    const data = await res.json();

    // Cache to DB
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO schedule_cache (group_number, data_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(group_number) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(groupNumber, JSON.stringify(data), now);

    // Save/update group metadata if present
    if (data.studentGroupDto) {
      const g = data.studentGroupDto;
      const groupStmt = db.prepare(`
        INSERT INTO groups (group_number, faculty, course, speciality, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(group_number) DO UPDATE SET
          faculty = excluded.faculty,
          course = excluded.course,
          speciality = excluded.speciality,
          updated_at = excluded.updated_at
      `);
      groupStmt.run(
        g.name || groupNumber,
        g.facultyAbbrev || '',
        g.course || 0,
        g.specialityAbbrev || g.specialityName || '',
        now
      );
    }

    return data;
  } catch (err) {
    console.error(`[BSUIR API] Error fetching schedule for group ${groupNumber}:`, err.message);
    // Fall back to cache if available
    const cached = db.prepare('SELECT data_json FROM schedule_cache WHERE group_number = ?').get(groupNumber);
    if (cached && cached.data_json) {
      console.log(`[BSUIR API] Serving cached schedule for group ${groupNumber}`);
      return JSON.parse(cached.data_json);
    }
    throw err;
  }
}

/**
 * Get schedule from cache or fetch from API
 */
export async function getSchedule(groupNumber, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = db.prepare('SELECT data_json, updated_at FROM schedule_cache WHERE group_number = ?').get(groupNumber);
    if (cached && cached.data_json) {
      const updatedAt = new Date(cached.updated_at);
      const hoursAgo = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60);
      if (hoursAgo < 12) {
        return JSON.parse(cached.data_json);
      }
    }
  }
  return await fetchGroupSchedule(groupNumber);
}

/**
 * Parse DD.MM.YYYY string to Date
 */
function parseBsuirDate(str) {
  if (!str) return null;
  const parts = str.split('.');
  if (parts.length === 3) {
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  return null;
}

/**
 * Calculate week number (1..4) for a given date, relative to today's current week
 */
export async function getWeekNumberForDate(targetDate) {
  const currentWeek = await fetchCurrentWeek();
  const today = new Date();
  
  // Normalize both to midnight UTC/local
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const targetMidnight = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  const diffMs = targetMidnight.getTime() - todayMidnight.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  
  // Day of week (0=Sun, 1=Mon, ..., 6=Sat)
  const currentDay = todayMidnight.getDay() === 0 ? 7 : todayMidnight.getDay();
  const targetDay = targetMidnight.getDay() === 0 ? 7 : targetMidnight.getDay();
  
  // Difference in calendar weeks (Monday to Sunday)
  const daysToStartOfCurrentWeek = currentDay - 1;
  const mondayCurrentWeek = new Date(todayMidnight);
  mondayCurrentWeek.setDate(todayMidnight.getDate() - daysToStartOfCurrentWeek);

  const daysToStartOfTargetWeek = targetDay - 1;
  const mondayTargetWeek = new Date(targetMidnight);
  mondayTargetWeek.setDate(targetMidnight.getDate() - daysToStartOfTargetWeek);

  const weekDiff = Math.round((mondayTargetWeek.getTime() - mondayCurrentWeek.getTime()) / (7 * 24 * 60 * 60 * 1000));

  let calcWeek = (currentWeek - 1 + (weekDiff % 4) + 4) % 4 + 1;
  return calcWeek;
}

export function toLocalDateString(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const date = typeof d === 'string' ? new Date(d) : d;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get lessons for a specific date (YYYY-MM-DD or Date object)
 */
export async function getLessonsForDate(groupNumber, dateInput) {
  let dateObj;
  let dateStr;

  if (typeof dateInput === 'string') {
    dateStr = dateInput;
    const [y, m, d] = dateInput.split('-').map(Number);
    dateObj = new Date(y, m - 1, d, 12, 0, 0);
  } else {
    dateObj = dateInput;
    dateStr = toLocalDateString(dateInput);
  }

  const dayName = DAYS_OF_WEEK[dateObj.getDay()];

  if (dayName === 'Воскресенье') {
    return [];
  }

  let scheduleData;
  try {
    scheduleData = await getSchedule(groupNumber);
  } catch (err) {
    console.error(`[BSUIR API] Could not get schedule for ${groupNumber}:`, err.message);
    scheduleData = null;
  }

  const weekNum = await getWeekNumberForDate(dateObj);
  const lessons = [];

  if (scheduleData && scheduleData.schedules && scheduleData.schedules[dayName]) {
    const rawLessons = scheduleData.schedules[dayName];

    for (const item of rawLessons) {
      // Check week number
      if (item.weekNumber && item.weekNumber.length > 0 && !item.weekNumber.includes(0)) {
        if (!item.weekNumber.includes(weekNum)) {
          continue;
        }
      }

      // Check date range
      if (item.startLessonDate && item.endLessonDate) {
        const start = parseBsuirDate(item.startLessonDate);
        const end = parseBsuirDate(item.endLessonDate);
        if (start && dateObj < start) continue;
        if (end && dateObj > end) continue;
      }

      // Check specific dateLesson
      if (item.dateLesson) {
        const specific = parseBsuirDate(item.dateLesson);
        if (specific && toLocalDateString(specific) !== dateStr) {
          continue;
        }
      }

      const teacher = item.employees && item.employees.length > 0
        ? `${item.employees[0].lastName || ''} ${(item.employees[0].firstName || '')[0] ? item.employees[0].firstName[0] + '.' : ''}${(item.employees[0].middleName || '')[0] ? item.employees[0].middleName[0] + '.' : ''}`.trim()
        : '';

      lessons.push({
        subject: item.subject || 'Предмет',
        subjectFullName: item.subjectFullName || item.subject || '',
        lessonType: item.lessonTypeAbbrev || 'ПЗ',
        startTime: item.startLessonTime || '09:00',
        endTime: item.endLessonTime || '10:20',
        subgroup: item.numSubgroup || 0,
        auditory: (item.auditories && item.auditories.join(', ')) || '',
        teacher,
        note: item.note || '',
        source: 'bsuir'
      });
    }
  }

  // Also include custom subjects for this day if any
  // Sort lessons by startTime
  lessons.sort((a, b) => a.startTime.localeCompare(b.startTime));

  return lessons;
}

/**
 * Extract unique list of all subjects from schedule
 */
export async function getUniqueSubjects(groupNumber) {
  try {
    const data = await getSchedule(groupNumber);
    const subjectsMap = new Map();

    if (data && data.schedules) {
      for (const day of Object.keys(data.schedules)) {
        for (const item of data.schedules[day]) {
          const key = `${item.subject}_${item.lessonTypeAbbrev || ''}`;
          if (!subjectsMap.has(key)) {
            subjectsMap.set(key, {
              shortName: item.subject,
              fullName: item.subjectFullName || item.subject,
              type: item.lessonTypeAbbrev || 'ПЗ'
            });
          }
        }
      }
    }

    return Array.from(subjectsMap.values());
  } catch (err) {
    return [];
  }
}
