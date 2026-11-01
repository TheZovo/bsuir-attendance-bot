import { Router } from 'express';
import * as groupService from '../../services/groupService.js';
import * as attendanceService from '../../services/attendanceService.js';
import * as bsuirApi from '../../services/bsuirApi.js';
import * as bsuirAuth from '../../services/bsuirAuth.js';
import { db } from '../../db/database.js';

const router = Router();

/**
 * Middleware to extract telegram user or fallback
 */
router.use((req, res, next) => {
  const telegramIdHeader = req.headers['x-telegram-user-id'] ||
                           req.headers['x-telegram-id'] ||
                           req.query.tg_user_id ||
                           req.query.telegramId ||
                           req.query.telegram_id;
  if (telegramIdHeader) {
    req.telegramId = parseInt(telegramIdHeader, 10);
  }
  next();
});

/**
 * GET /api/me - Current user context
 */
router.get('/me', (req, res) => {
  let user = null;
  if (req.telegramId) {
    user = groupService.getUser(req.telegramId);
  }

  const defaultGroup = (user && user.group_number) || groupService.getDefaultGroup() || '562001';
  const isMain = req.telegramId ? groupService.isMainHeadman(req.telegramId) : true;

  if (!user) {
    return res.json({
      telegramId: req.telegramId || 0,
      firstName: isMain ? 'Главный Староста' : 'Студент',
      username: '',
      role: isMain ? 'headman' : 'student',
      isMainHeadman: isMain,
      groupNumber: defaultGroup,
      studentId: null,
      isDemo: !req.telegramId
    });
  }

  res.json({
    telegramId: user.telegram_id,
    firstName: user.first_name,
    lastName: user.last_name,
    username: user.username,
    role: isMain ? 'headman' : user.role,
    isMainHeadman: isMain,
    groupNumber: user.group_number || defaultGroup,
    studentId: user.student_id,
    isDemo: false
  });
});

/**
 * POST /api/me/role - Switch role (for testing or permission grant)
 */
router.post('/me/role', (req, res) => {
  const { role, telegramId } = req.body;
  const targetId = telegramId || req.telegramId;
  if (targetId) {
    groupService.setUserRole(targetId, role);
  }
  res.json({ success: true, role });
});

/**
 * GET /api/group - Group information
 */
router.get('/group', async (req, res) => {
  const groupNumber = req.query.groupNumber || groupService.getDefaultGroup() || '562001';
  const meta = groupService.getGroupMeta(groupNumber);
  const currentWeek = await bsuirApi.fetchCurrentWeek();
  const students = groupService.getStudents(groupNumber);

  res.json({
    groupNumber,
    faculty: meta ? meta.faculty : '',
    course: meta ? meta.course : '',
    speciality: meta ? meta.speciality : '',
    currentWeek,
    studentCount: students.length
  });
});

/**
 * POST /api/group/set - Change group and sync from BSUIR
 */
router.post('/group/set', async (req, res) => {
  const { groupNumber } = req.body;
  if (!groupNumber) {
    return res.status(400).json({ error: 'Group number required' });
  }

  try {
    groupService.setDefaultGroup(groupNumber);
    // Fetch and cache BSUIR schedule
    await bsuirApi.fetchGroupSchedule(groupNumber);

    if (req.telegramId) {
      groupService.saveUser({ telegramId: req.telegramId, groupNumber });
    }

    res.json({ success: true, groupNumber });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schedule from BSUIR: ' + err.message });
  }
});

/**
 * POST /api/group/sync-bsuir - Force re-sync schedule from BSUIR
 */
router.post('/group/sync-bsuir', async (req, res) => {
  const groupNumber = req.body.groupNumber || groupService.getDefaultGroup();
  if (!groupNumber) return res.status(400).json({ error: 'No group selected' });

  try {
    const data = await bsuirApi.fetchGroupSchedule(groupNumber);
    res.json({ success: true, message: 'Расписание успешно обновлено с ИИС БГУИР' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/group/sync-iis-students - Sync group roster from IIS
 */
router.post('/group/sync-iis-students', async (req, res) => {
  const { username, password, groupNumber } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль от ИИС обязательны' });
  }

  try {
    const authRes = await bsuirAuth.loginToIis(username, password);
    if (!authRes.success) {
      return res.status(401).json({ error: authRes.error });
    }

    const targetGroup = groupNumber || authRes.profile.groupNumber || groupService.getDefaultGroup() || '562001';

    if (authRes.groupStudents && authRes.groupStudents.length > 0) {
      groupService.clearGroupStudents(targetGroup, true);
      for (const s of authRes.groupStudents) {
        groupService.addStudent(targetGroup, s.fullName, s.subgroup || 0);
      }
    }

    const students = groupService.getStudents(targetGroup);
    res.json({
      success: true,
      syncedCount: authRes.groupStudents ? authRes.groupStudents.length : 0,
      totalStudents: students.length,
      students
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/schedule/date - Lessons for a given date
 */
router.get('/schedule/date', async (req, res) => {
  const groupNumber = req.query.groupNumber || groupService.getDefaultGroup() || '562001';
  const dateStr = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const lessons = await attendanceService.syncDayLessons(groupNumber, dateStr);
    const weekNum = await bsuirApi.getWeekNumberForDate(new Date(dateStr + 'T00:00:00'));
    res.json({ date: dateStr, weekNum, lessons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/students - List of students
 */
router.get('/students', (req, res) => {
  const groupNumber = req.query.groupNumber || groupService.getDefaultGroup() || '562001';
  const subgroup = req.query.subgroup ? parseInt(req.query.subgroup, 10) : null;
  const students = groupService.getStudents(groupNumber, subgroup);
  res.json(students);
});

/**
 * POST /api/students - Add single student or bulk
 */
router.post('/students', (req, res) => {
  const { groupNumber, fullName, textList, subgroup } = req.body;
  const targetGroup = groupNumber || groupService.getDefaultGroup() || '562001';

  if (textList) {
    const result = groupService.bulkAddStudents(targetGroup, textList);
    return res.json({ success: true, ...result });
  }

  if (!fullName) {
    return res.status(400).json({ error: 'Full name required' });
  }

  const student = groupService.addStudent(targetGroup, fullName, subgroup || 0);
  res.json({ success: true, student });
});

/**
 * DELETE /api/students/:id - Remove student
 */
router.delete('/students/:id', (req, res) => {
  groupService.deleteStudent(parseInt(req.params.id, 10));
  res.json({ success: true });
});

/**
 * PATCH /api/students/:id/subgroup - Update student's subgroup
 */
router.patch('/students/:id/subgroup', (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const { subgroup } = req.body;
  const updated = groupService.updateStudentSubgroup(studentId, subgroup);
  if (!updated) {
    return res.status(404).json({ error: 'Студент не найден' });
  }
  res.json({ success: true, student: updated });
});

/**
 * GET /api/attendance/lesson/:id - Attendance for a lesson
 */
router.get('/attendance/lesson/:id', (req, res) => {
  const lessonId = parseInt(req.params.id, 10);
  const data = attendanceService.getLessonAttendance(lessonId);
  if (!data) return res.status(404).json({ error: 'Lesson not found' });
  res.json(data);
});

/**
 * POST /api/attendance/mark - Set attendance for single student
 */
router.post('/attendance/mark', (req, res) => {
  const { lessonId, studentId, status, note } = req.body;
  if (!lessonId || !studentId || !status) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const record = attendanceService.setAttendance({
    lessonId: parseInt(lessonId, 10),
    studentId: parseInt(studentId, 10),
    status,
    note,
    markedBy: req.telegramId || null
  });

  res.json({ success: true, record });
});

/**
 * POST /api/attendance/lesson/:id/all-present - Mark all present
 */
router.post('/attendance/lesson/:id/all-present', (req, res) => {
  const lessonId = parseInt(req.params.id, 10);
  const result = attendanceService.markAllPresent(lessonId, req.telegramId || null);
  res.json({ success: true, ...result });
});

/**
 * POST /api/attendance/lesson/:id/batch - Save all marks for lesson
 */
router.post('/attendance/lesson/:id/batch', (req, res) => {
  const lessonId = parseInt(req.params.id, 10);
  const { marks } = req.body; // array of { studentId, status, note }
  const result = attendanceService.batchSaveAttendance(lessonId, marks, req.telegramId || null);
  res.json({ success: true, ...result });
});

/**
 * GET /api/attendance/day - Day-by-day attendance sheet
 */
router.get('/attendance/day', async (req, res) => {
  const groupNumber = req.query.groupNumber || groupService.getDefaultGroup() || '562001';
  const dateStr = req.query.date || new Date().toISOString().split('T')[0];
  const subgroup = req.query.subgroup ? parseInt(req.query.subgroup, 10) : 0;

  try {
    const lessons = await attendanceService.syncDayLessons(groupNumber, dateStr);
    const students = groupService.getStudents(groupNumber, subgroup);
    const weekNum = await bsuirApi.getWeekNumberForDate(new Date(dateStr + 'T00:00:00'));

    const lessonIds = lessons.map(l => l.id);
    const marksMap = {};

    if (lessonIds.length > 0) {
      const placeholders = lessonIds.map(() => '?').join(',');
      const marks = db.prepare(`SELECT * FROM attendance WHERE lesson_id IN (${placeholders})`).all(...lessonIds);
      for (const m of marks) {
        marksMap[`${m.student_id}_${m.lesson_id}`] = m;
      }
    }

    // Calculate daily status summary for each student
    const enrichedStudents = students.map(s => {
      let absentCount = 0;
      let validCount = 0;
      let lateCount = 0;
      let presentCount = 0;

      for (const l of lessons) {
        if (l.subgroup !== 0 && s.subgroup !== 0 && l.subgroup !== s.subgroup) {
          continue;
        }
        const mark = marksMap[`${s.id}_${l.id}`];
        if (mark) {
          if (mark.status === 'absent') absentCount++;
          else if (mark.status === 'valid_reason') validCount++;
          else if (mark.status === 'late') lateCount++;
          else presentCount++;
        } else {
          presentCount++; // Default present
        }
      }

      return {
        id: s.id,
        fullName: s.full_name,
        subgroup: s.subgroup,
        telegramId: s.telegram_id,
        dayStats: {
          absentCount,
          validCount,
          lateCount,
          presentCount,
          totalHoursMissed: (absentCount + validCount) * 2
        }
      };
    });

    res.json({
      groupNumber,
      date: dateStr,
      weekNum,
      lessons,
      students: enrichedStudents,
      marks: marksMap
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attendance/day/all-present - Mark all students present for all day lessons
 */
router.post('/attendance/day/all-present', async (req, res) => {
  const { date, groupNumber } = req.body;
  const targetGroup = groupNumber || groupService.getDefaultGroup() || '562001';
  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    const lessons = await attendanceService.syncDayLessons(targetGroup, targetDate);
    for (const l of lessons) {
      attendanceService.markAllPresent(l.id, req.telegramId || null);
    }
    res.json({ success: true, count: lessons.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/headman/apply - Apply for deputy headman
 */
router.post('/headman/apply', (req, res) => {
  const { telegramId, firstName, username, groupNumber } = req.body;
  const targetId = telegramId || req.telegramId;
  if (!targetId) return res.status(400).json({ error: 'Telegram ID required' });

  const request = groupService.createHeadmanRequest({
    telegramId: targetId,
    firstName: firstName || 'Студент',
    username: username || '',
    groupNumber: groupNumber || groupService.getDefaultGroup() || '562001'
  });

  res.json({ success: true, request });
});

/**
 * POST /api/attendance/valid-reason - Submit valid reason (ОРВИ/Справка) and auto-mark
 */
router.post('/attendance/valid-reason', async (req, res) => {
  const { studentId, reasonType, startDate, endDate, note } = req.body;
  if (!studentId || !startDate || !endDate) {
    return res.status(400).json({ error: 'Student, start date and end date are required' });
  }

  try {
    const result = await attendanceService.submitValidReason({
      studentId: parseInt(studentId, 10),
      telegramId: req.telegramId || null,
      reasonType: reasonType || 'ОРВИ',
      startDate,
      endDate,
      note
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/attendance/valid-reasons/:studentId - Get student's valid reason records
 */
router.get('/attendance/valid-reasons/:studentId', (req, res) => {
  const studentId = parseInt(req.params.studentId, 10);
  const reasons = attendanceService.getStudentValidReasons(studentId);
  res.json(reasons);
});

/**
 * POST /api/auth/iis-login - Login via IIS BSUIR credentials
 */
router.post('/auth/iis-login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }

  const authRes = await bsuirAuth.loginToIis(username, password);
  if (!authRes.success) {
    return res.status(401).json({ error: authRes.error });
  }

  const p = authRes.profile;
  const isMainHeadman = req.telegramId && groupService.isMainHeadman(req.telegramId);
  const targetGroup = p.groupNumber || (isMainHeadman ? '562001' : null) || groupService.getDefaultGroup() || '562001';

  // Ensure schedule is cached
  await bsuirApi.fetchGroupSchedule(targetGroup).catch(() => {});

  const student = groupService.linkOrRegisterStudent({
    groupNumber: targetGroup,
    fullName: p.fullName || 'Студент',
    studentCard: p.studentCardNumber,
    telegramId: req.telegramId || null
  });

  // If IIS provided group roster, add students
  if (authRes.groupStudents && authRes.groupStudents.length > 0) {
    groupService.clearGroupStudents(targetGroup, true);
    for (const s of authRes.groupStudents) {
      const sName = s.fullName || s.fio || `${s.lastName || ''} ${s.firstName || ''} ${s.middleName || ''}`.trim();
      if (sName) {
        groupService.addStudent(targetGroup, sName, s.subgroup || 0);
      }
    }
  }

  res.json({ success: true, student, profile: p, groupNumber: targetGroup });
});

/**
 * POST /api/auth/student-card - Deprecated / disabled manual card registration
 */
router.post('/auth/student-card', async (req, res) => {
  return res.status(400).json({ error: 'Регистрация по ФИО отключена. Пожалуйста, используйте вход через личный кабинет ИИС БГУИР.' });
});

/**
 * GET /api/attendance/grid - Full attendance matrix for table
 */
router.get('/attendance/grid', (req, res) => {
  const groupNumber = req.query.groupNumber || groupService.getDefaultGroup() || '562001';
  const grid = attendanceService.getGroupGrid(groupNumber);
  res.json(grid);
});

/**
 * GET /api/attendance/student/:id - Student personal stats & history
 */
router.get('/attendance/student/:id', (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const stats = attendanceService.getStudentStats(studentId);
  if (!stats) return res.status(404).json({ error: 'Student not found' });
  res.json(stats);
});

/**
 * GET /api/attendance/summary - Group overall summary
 */
router.get('/attendance/summary', (req, res) => {
  const groupNumber = req.query.groupNumber || groupService.getDefaultGroup() || '562001';
  const summary = attendanceService.getGroupSummary(groupNumber);
  res.json(summary);
});

/**
 * POST /api/custom-subject - Add custom subject
 */
router.post('/custom-subject', (req, res) => {
  const { groupNumber, name, fullName, lessonType, teacher, subgroup } = req.body;
  const targetGroup = groupNumber || groupService.getDefaultGroup() || '562001';

  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = groupService.addCustomSubject(targetGroup, { name, fullName, lessonType, teacher, subgroup });
  res.json({ success: true, id: result.lastInsertRowid });
});

/**
 * GET /api/attendance/export - CSV export of attendance
 */
router.get('/attendance/export', (req, res) => {
  const groupNumber = req.query.groupNumber || groupService.getDefaultGroup() || '562001';
  const grid = attendanceService.getGroupGrid(groupNumber);

  // Build CSV
  // Header: ФИО, Подгруппа, Всего НБ (ч), Всего УВ (ч), Итого (ч), [Lesson 1], [Lesson 2]...
  const lessonHeaders = grid.lessons.map(l => `"${l.date} ${l.subject} (${l.lessonType})"`).join(',');
  let csv = `\uFEFF"ФИО","Подгруппа","НБ (часов)","УВ (часов)","Всего пропущено (ч)",${lessonHeaders}\n`;

  for (const s of grid.students) {
    const row = [
      `"${s.fullName}"`,
      s.subgroup || 'Вся',
      s.nbHours,
      s.uvHours,
      s.totalHours
    ];

    for (const l of grid.lessons) {
      const mark = grid.marks[`${s.id}_${l.id}`];
      let val = 'Был';
      if (mark) {
        if (mark.status === 'absent') val = 'НБ';
        else if (mark.status === 'valid_reason') val = 'УВ';
        else if (mark.status === 'late') val = 'Оп';
      }
      row.push(`"${val}"`);
    }

    csv += row.join(',') + '\n';
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${groupNumber}_${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(csv);
});

export default router;
