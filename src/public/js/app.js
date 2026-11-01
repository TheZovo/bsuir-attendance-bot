/**
 * BSUIR Group Attendance Mini App (TMA)
 * Day-by-Day Sheet & Schedule System
 */

const tg = window.Telegram?.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
  } catch (e) {
    console.warn('Telegram WebApp init error:', e);
  }
}

function toLocalDateString(d) {
  const date = d || new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Current App State
const state = {
  user: {
    telegramId: tg?.initDataUnsafe?.user?.id || 0,
    firstName: tg?.initDataUnsafe?.user?.first_name || 'Пользователь',
    username: tg?.initDataUnsafe?.user?.username || '',
    role: 'student',
    isMainHeadman: false,
    groupNumber: '562001'
  },
  currentDate: toLocalDateString(new Date()),
  dayData: null,
  activeTab: 'day',
  activeScheduleDayIndex: Math.min(Math.max(new Date().getDay() - 1, 0), 5),
  dayViewMode: 'table',
  rosterFilter: 'all'
};

const RU_DAYS = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
const RU_DAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// DOM Elements
const elements = {
  groupTitle: document.getElementById('groupTitle'),
  weekBadge: document.getElementById('weekBadge'),
  userRoleBadge: document.getElementById('userRoleBadge'),
  roleLabelText: document.getElementById('roleLabelText'),
  btnApplyHeadman: document.getElementById('btnApplyHeadman'),
  btnChangeGroupHeader: document.getElementById('btnChangeGroupHeader'),
  navTabs: document.getElementById('navTabs'),
  tabStudents: document.getElementById('tabStudents'),
  views: {
    day: document.getElementById('viewDay'),
    summary: document.getElementById('viewSummary'),
    schedule: document.getElementById('viewSchedule'),
    students: document.getElementById('viewStudents')
  },
  // Day Navigator
  btnPrevDay: document.getElementById('btnPrevDay'),
  btnNextDay: document.getElementById('btnNextDay'),
  dayNameLabel: document.getElementById('dayNameLabel'),
  dateFormattedLabel: document.getElementById('dateFormattedLabel'),
  nativeDatePicker: document.getElementById('nativeDatePicker'),
  quickDaysStrip: document.getElementById('quickDaysStrip'),
  dayLessonsStrip: document.getElementById('dayLessonsStrip'),
  dayPairsCounterBadge: document.getElementById('dayPairsCounterBadge'),
  lessonsChipsList: document.getElementById('lessonsChipsList'),
  btnModeTable: document.getElementById('btnModeTable'),
  btnModeRoster: document.getElementById('btnModeRoster'),
  btnCopyDayReport: document.getElementById('btnCopyDayReport'),
  dayStudentSearch: document.getElementById('dayStudentSearch'),
  daySubgroupFilter: document.getElementById('daySubgroupFilter'),
  btnDayAllPresent: document.getElementById('btnDayAllPresent'),
  dayLoading: document.getElementById('dayLoading'),
  dayTableWrap: document.getElementById('dayTableWrap'),
  dayTable: document.getElementById('dayTable'),
  dayTableHeaderRow: document.getElementById('dayTableHeaderRow'),
  dayTableBody: document.getElementById('dayTableBody'),
  dayRosterWrap: document.getElementById('dayRosterWrap'),
  rosterCountPresent: document.getElementById('rosterCountPresent'),
  rosterCountAbsent: document.getElementById('rosterCountAbsent'),
  rosterCountValid: document.getElementById('rosterCountValid'),
  countPillAll: document.getElementById('countPillAll'),
  countPillAbsent: document.getElementById('countPillAbsent'),
  countPillValid: document.getElementById('countPillValid'),
  countPillPresent: document.getElementById('countPillPresent'),
  rosterStudentsList: document.getElementById('rosterStudentsList'),
  noLessonsNotice: document.getElementById('noLessonsNotice'),
  // Summary
  kpiTotalNb: document.getElementById('kpiTotalNb'),
  kpiTotalUv: document.getElementById('kpiTotalUv'),
  kpiTotalMissed: document.getElementById('kpiTotalMissed'),
  summarySearch: document.getElementById('summarySearch'),
  btnExportCsv: document.getElementById('btnExportCsv'),
  summaryStudentsList: document.getElementById('summaryStudentsList'),
  // Schedule
  btnSyncBsuir: document.getElementById('btnSyncBsuir'),
  scheduleDaysNav: document.getElementById('scheduleDaysNav'),
  scheduleLessonsList: document.getElementById('scheduleLessonsList'),
  // Students
  studentsListContainer: document.getElementById('studentsListContainer'),
  newStudentName: document.getElementById('newStudentName'),
  newStudentSubgroup: document.getElementById('newStudentSubgroup'),
  btnAddSingleStudent: document.getElementById('btnAddSingleStudent'),
  btnOpenBulkModal: document.getElementById('btnOpenBulkModal'),
  bulkModal: document.getElementById('bulkModal'),
  btnCloseBulkModal: document.getElementById('btnCloseBulkModal'),
  btnCancelBulk: document.getElementById('btnCancelBulk'),
  btnSaveBulk: document.getElementById('btnSaveBulk'),
  bulkStudentsText: document.getElementById('bulkStudentsText'),
  customSubjectForm: document.getElementById('customSubjectForm'),
  // Change group modal
  changeGroupModal: document.getElementById('changeGroupModal'),
  btnCloseChangeGroup: document.getElementById('btnCloseChangeGroup'),
  btnCancelChangeGroup: document.getElementById('btnCancelChangeGroup'),
  btnConfirmChangeGroup: document.getElementById('btnConfirmChangeGroup'),
  modalGroupInput: document.getElementById('modalGroupInput'),
  toast: document.getElementById('toast')
};

function showToast(message, duration = 2500) {
  elements.toast.textContent = message;
  elements.toast.style.display = 'block';
  setTimeout(() => {
    elements.toast.style.display = 'none';
  }, duration);
}

async function api(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-telegram-user-id': state.user.telegramId ? state.user.telegramId.toString() : '0',
    ...options.headers
  };

  const response = await fetch('/api' + endpoint, {
    ...options,
    headers
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error ${response.status}`);
  }

  return await response.json();
}

/**
 * App Bootstrapper
 */
async function initApp() {
  setupEventListeners();

  // Load user context
  try {
    const me = await api('/me');
    state.user = { ...state.user, ...me };
  } catch (e) {
    console.warn('Fallback to local state');
  }

  updateRoleUI();
  await loadGroupInfo();

  // Render initial day chips & day attendance
  renderQuickDaysStrip();
  updateDateDisplay();
  await loadDayAttendance();
}

/**
 * Configure UI based on role
 */
function updateRoleUI() {
  const isHeadman = state.user.role === 'headman' || state.user.role === 'deputy' || state.user.isMainHeadman;

  if (isHeadman) {
    elements.userRoleBadge.className = 'role-badge headman';
    elements.roleLabelText.textContent = state.user.isMainHeadman ? 'Главный староста' : 'Староста';
    elements.btnApplyHeadman.style.display = 'none';
    elements.tabStudents.style.display = 'inline-block';
    elements.btnDayAllPresent.style.display = 'inline-flex';
  } else {
    elements.userRoleBadge.className = 'role-badge student';
    elements.roleLabelText.textContent = 'Студент';
    elements.btnApplyHeadman.style.display = 'inline-flex';
    elements.tabStudents.style.display = 'none';
    elements.btnDayAllPresent.style.display = 'none';
  }
}

/**
 * Load Group metadata
 */
async function loadGroupInfo() {
  try {
    const group = await api(`/group?groupNumber=${encodeURIComponent(state.user.groupNumber)}`);
    elements.groupTitle.textContent = `Группа ${group.groupNumber}`;
    elements.weekBadge.textContent = `${group.currentWeek}-я учебная неделя`;
  } catch (err) {
    console.error('Group info error:', err);
  }
}

/**
 * Format date display
 */
function updateDateDisplay() {
  const d = new Date(state.currentDate + 'T00:00:00');
  elements.dayNameLabel.textContent = RU_DAYS[d.getDay()];
  elements.dateFormattedLabel.textContent = `${d.getDate()} ${RU_MONTHS[d.getMonth()]}`;
  elements.nativeDatePicker.value = state.currentDate;
}

/**
 * Render Monday..Saturday chips for the current date's week
 */
function renderQuickDaysStrip() {
  const [cy, cm, cd] = state.currentDate.split('-').map(Number);
  const curr = new Date(cy, cm - 1, cd, 12, 0, 0);
  const dayOfWeek = curr.getDay() === 0 ? 7 : curr.getDay(); // 1=Mon..7=Sun
  const monday = new Date(curr);
  monday.setDate(curr.getDate() - (dayOfWeek - 1));

  elements.quickDaysStrip.innerHTML = '';

  for (let i = 0; i < 6; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = toLocalDateString(d);

    const chip = document.createElement('div');
    chip.className = `quick-day-chip ${dateStr === state.currentDate ? 'active' : ''}`;
    chip.innerHTML = `
      <span class="chip-name">${RU_DAYS_SHORT[d.getDay()]}</span>
      <span class="chip-num">${d.getDate()}</span>
    `;

    chip.addEventListener('click', () => {
      state.currentDate = dateStr;
      updateDateDisplay();
      renderQuickDaysStrip();
      loadDayAttendance();
    });

    elements.quickDaysStrip.appendChild(chip);
  }
}

/* ==========================================================================
   1. DAY-BY-DAY ATTENDANCE VIEW (Журнал по дням)
   ========================================================================== */

function getLessonPairSlot(lesson, allLessons = []) {
  if (lesson.lesson_index && lesson.lesson_index > 0 && lesson.lesson_index <= 8) {
    return lesson.lesson_index;
  }
  const time = lesson.start_time || lesson.startTime;
  if (time) {
    const parts = time.split(':').map(Number);
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const totalMinutes = parts[0] * 60 + parts[1];
      if (totalMinutes < 9 * 60 + 40) return 1;
      if (totalMinutes < 11 * 60 + 35) return 2;
      if (totalMinutes < 13 * 60 + 20) return 3;
      if (totalMinutes < 15 * 60 + 10) return 4;
      if (totalMinutes < 17 * 60) return 5;
      if (totalMinutes < 18 * 60 + 40) return 6;
      if (totalMinutes < 20 * 60 + 20) return 7;
      return 8;
    }
  }
  if (allLessons.length > 0) {
    const times = [...new Set(allLessons.map(l => l.start_time || l.startTime))].sort();
    const idx = times.indexOf(time);
    if (idx !== -1) return idx + 1;
  }
  return 1;
}

function getPairWord(count) {
  const rem10 = count % 10;
  const rem100 = count % 100;
  if (rem100 >= 11 && rem100 <= 19) return 'пар';
  if (rem10 === 1) return 'пара';
  if (rem10 >= 2 && rem10 <= 4) return 'пары';
  return 'пар';
}

async function loadDayAttendance() {
  elements.dayLoading.style.display = 'flex';
  elements.dayTableWrap.style.display = 'none';
  if (elements.dayRosterWrap) elements.dayRosterWrap.style.display = 'none';
  elements.noLessonsNotice.style.display = 'none';

  try {
    const data = await api(`/attendance/day?date=${state.currentDate}&groupNumber=${encodeURIComponent(state.user.groupNumber)}`);
    state.dayData = data;
    renderDayLessonsOverview(data.lessons);
    renderDayView();
  } catch (err) {
    showToast('Ошибка загрузки: ' + err.message);
  } finally {
    elements.dayLoading.style.display = 'none';
  }
}

function renderDayView() {
  if (!state.dayData) return;

  const { lessons } = state.dayData;
  if (!lessons || lessons.length === 0) {
    elements.dayTableWrap.style.display = 'none';
    if (elements.dayRosterWrap) elements.dayRosterWrap.style.display = 'none';
    elements.noLessonsNotice.style.display = 'block';
    return;
  }

  elements.noLessonsNotice.style.display = 'none';

  if (state.dayViewMode === 'roster') {
    elements.dayTableWrap.style.display = 'none';
    if (elements.dayRosterWrap) {
      elements.dayRosterWrap.style.display = 'flex';
      renderDayRoster();
    }
  } else {
    if (elements.dayRosterWrap) elements.dayRosterWrap.style.display = 'none';
    elements.dayTableWrap.style.display = 'block';
    renderDayTable();
  }
}

function renderDayLessonsOverview(lessons) {
  elements.lessonsChipsList.innerHTML = '';

  if (!lessons || lessons.length === 0) {
    elements.dayLessonsStrip.style.display = 'none';
    if (elements.dayPairsCounterBadge) elements.dayPairsCounterBadge.textContent = '0 пар';
    return;
  }

  elements.dayLessonsStrip.style.display = 'block';

  // Group lessons by pair slot
  const slotsMap = new Map();
  lessons.forEach(l => {
    const slot = getLessonPairSlot(l, lessons);
    if (!slotsMap.has(slot)) {
      slotsMap.set(slot, {
        slot,
        startTime: l.start_time || l.startTime,
        endTime: l.end_time || l.endTime,
        items: []
      });
    }
    slotsMap.get(slot).items.push(l);
  });

  const sortedSlots = [...slotsMap.values()].sort((a, b) => a.slot - b.slot);
  const totalPairs = sortedSlots.length;
  const totalHours = totalPairs * 2;

  if (elements.dayPairsCounterBadge) {
    elements.dayPairsCounterBadge.textContent = `${totalPairs} ${getPairWord(totalPairs)} • ${totalHours} ч.`;
  }

  sortedSlots.forEach(s => {
    const card = document.createElement('div');
    card.className = 'pair-slot-card';

    const timeRange = s.startTime + (s.endTime ? ` – ${s.endTime}` : '');

    let itemsHtml = '';
    s.items.forEach(item => {
      const subgBadge = item.subgroup === 1
        ? `<span class="pair-subg-badge sub-1">1 п/г</span>`
        : item.subgroup === 2
          ? `<span class="pair-subg-badge sub-2">2 п/г</span>`
          : '';
      const audBadge = item.auditory ? `<span class="pair-aud-badge">📍 ${escapeHtml(item.auditory)}</span>` : '';
      const teacherBadge = item.teacher ? `<span class="pair-teacher-badge">👨‍🏫 ${escapeHtml(item.teacher)}</span>` : '';

      itemsHtml += `
        <div class="pair-lesson-subitem">
          ${subgBadge}
          <span class="pair-subj-name">${escapeHtml(item.subject)}</span>
          <span class="pair-type-badge">${escapeHtml(item.lesson_type || 'ПЗ')}</span>
          ${audBadge}
          ${teacherBadge}
        </div>
      `;
    });

    card.innerHTML = `
      <div class="pair-slot-header">
        <span class="pair-slot-num">${s.slot} пара</span>
        <span class="pair-slot-time">${timeRange}</span>
      </div>
      <div class="pair-slot-items">
        ${itemsHtml}
      </div>
    `;

    elements.lessonsChipsList.appendChild(card);
  });
}

function renderDayTable() {
  if (!state.dayData) return;

  const { lessons, students, marks } = state.dayData;
  const filterSubgroup = parseInt(elements.daySubgroupFilter.value, 10);
  const searchQuery = elements.dayStudentSearch.value.trim().toLowerCase();

  // If no lessons on this date
  if (!lessons || lessons.length === 0) {
    elements.dayTableWrap.style.display = 'none';
    elements.noLessonsNotice.style.display = 'block';
    return;
  }

  elements.noLessonsNotice.style.display = 'none';
  elements.dayTableWrap.style.display = 'block';

  // Filter students
  const filteredStudents = students.filter(s => {
    if (filterSubgroup !== 0 && s.subgroup !== 0 && s.subgroup !== filterSubgroup) {
      return false;
    }
    if (searchQuery && !s.fullName.toLowerCase().includes(searchQuery)) {
      return false;
    }
    return true;
  });

  // Build Table Header
  elements.dayTableHeaderRow.innerHTML = `
    <th class="sticky-col">Студент (${filteredStudents.length})</th>
  `;

  lessons.forEach((lesson) => {
    const pairSlot = getLessonPairSlot(lesson, lessons);
    const th = document.createElement('th');
    th.className = 'th-lesson-col';
    const subg = lesson.subgroup ? ` (${lesson.subgroup}п)` : '';
    th.innerHTML = `
      <div class="th-lesson-time">${pairSlot} пара • ${lesson.start_time}</div>
      <span class="th-lesson-subj">${escapeHtml(lesson.subject)}</span>
      <span class="th-lesson-type">${escapeHtml(lesson.lesson_type)}${subg}</span>
    `;
    elements.dayTableHeaderRow.appendChild(th);
  });
    elements.dayTableHeaderRow.appendChild(th);
  });

  // Column for day total
  const thTotal = document.createElement('th');
  thTotal.className = 'col-day-total';
  thTotal.textContent = 'Итог дня';
  elements.dayTableHeaderRow.appendChild(thTotal);

  // Build Table Body
  elements.dayTableBody.innerHTML = '';

  if (filteredStudents.length === 0) {
    elements.dayTableBody.innerHTML = `
      <tr>
        <td colspan="${2 + lessons.length}" style="text-align: center; padding: 24px; color: var(--hint-color);">
          Студенты не найдены.
        </td>
      </tr>
    `;
    return;
  }

function canEditAttendance() {
  return state.user.role === 'headman' ||
         state.user.role === 'deputy' ||
         state.user.isMainHeadman ||
         state.user.telegramId === 6567758362 ||
         state.user.isDemo ||
         !state.user.telegramId;
}

function renderInteractiveCellButton(student, lesson, status) {
  const statusLabels = {
    'present': '🟢 Был',
    'absent': '🔴 НБ',
    'valid_reason': '🟡 УВ',
    'late': '🟠 Оп'
  };
  const statusClasses = {
    'present': 'btn-cell-present',
    'absent': 'btn-cell-absent',
    'valid_reason': 'btn-cell-valid',
    'late': 'btn-cell-late'
  };

  const label = statusLabels[status] || '🟢 Был';
  const cls = statusClasses[status] || 'btn-cell-present';

  return `
    <div class="cell-mark-wrapper" id="wrap-${student.id}-${lesson.id}">
      <button type="button" class="btn-cell-mark ${cls}" data-action="toggle" title="Нажмите: сразу переключить [Был / НБ]">
        ${label}
      </button>
      <button type="button" class="btn-cell-more" data-action="menu" title="Выбрать статус (УВ, Оп, Был, НБ)">⋮</button>
    </div>
  `;
}

function setupCellEventListeners(cellTd, student, lesson) {
  const toggleBtn = cellTd.querySelector('[data-action="toggle"]');
  const moreBtn = cellTd.querySelector('[data-action="menu"]');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllCellPopovers();
      const markKey = `${student.id}_${lesson.id}`;
      const cur = state.dayData.marks[markKey];
      const curStatus = cur ? cur.status : 'present';
      // Direct 1-click toggle: present <-> absent
      const nextStatus = curStatus === 'present' ? 'absent' : 'present';
      setStudentLessonStatus(student, lesson, nextStatus, cellTd);
    });
  }

  if (moreBtn) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrapper = cellTd.querySelector('.cell-mark-wrapper');
      const existingPopover = wrapper.querySelector('.cell-menu-popover');
      if (existingPopover) {
        existingPopover.remove();
        return;
      }

      closeAllCellPopovers();

      const popover = document.createElement('div');
      popover.className = 'cell-menu-popover';
      popover.innerHTML = `
        <button type="button" class="cell-menu-item" data-status="present">🟢 Был</button>
        <button type="button" class="cell-menu-item" data-status="absent">🔴 НБ (Не был)</button>
        <button type="button" class="cell-menu-item" data-status="valid_reason">🟡 УВ (Уважительная)</button>
        <button type="button" class="cell-menu-item" data-status="late">🟠 Оп (Опоздал)</button>
      `;

      popover.querySelectorAll('.cell-menu-item').forEach(item => {
        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const target = item.getAttribute('data-status');
          popover.remove();
          setStudentLessonStatus(student, lesson, target, cellTd);
        });
      });

      wrapper.appendChild(popover);
    });
  }
}

function closeAllCellPopovers() {
  document.querySelectorAll('.cell-menu-popover').forEach(p => p.remove());
}

// Global click to close popovers
document.addEventListener('click', () => {
  closeAllCellPopovers();
});

async function setStudentLessonStatus(student, lesson, targetStatus, cellTd) {
  const markKey = `${student.id}_${lesson.id}`;
  state.dayData.marks[markKey] = {
    lesson_id: lesson.id,
    student_id: student.id,
    status: targetStatus
  };

  if (cellTd) {
    cellTd.innerHTML = renderInteractiveCellButton(student, lesson, targetStatus);
    setupCellEventListeners(cellTd, student, lesson);
  }

  // Recalculate student day stats
  let missedHours = 0;
  state.dayData.lessons.forEach(l => {
    if (l.subgroup !== 0 && student.subgroup !== 0 && l.subgroup !== student.subgroup) return;
    const m = state.dayData.marks[`${student.id}_${l.id}`];
    const s = m ? m.status : 'present';
    if (s === 'absent' || s === 'valid_reason') {
      missedHours += (l.hours || 2);
    }
  });

  student.dayStats = student.dayStats || {};
  student.dayStats.totalHoursMissed = missedHours;

  const totalEl = document.getElementById(`day-tot-${student.id}`);
  if (totalEl) totalEl.innerHTML = renderDayTotalPill(student.dayStats);
  if (state.dayViewMode === 'roster') renderDayRoster();

  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    await api('/attendance/mark', {
      method: 'POST',
      body: JSON.stringify({
        lessonId: lesson.id,
        studentId: student.id,
        status: targetStatus
      })
    });
  } catch (err) {
    showToast('Ошибка сохранения: ' + err.message);
  }
}

  filteredStudents.forEach(student => {
    const tr = document.createElement('tr');
    const isHeadman = canEditAttendance();

    // Subgroup badge: interactive chip for headman, static badge for student
    let subgBadgeHtml = '';
    if (isHeadman) {
      const subLabel = student.subgroup === 1 ? '1 п/г' : (student.subgroup === 2 ? '2 п/г' : 'Вся');
      const subClass = student.subgroup === 1 ? 'sub-1' : (student.subgroup === 2 ? 'sub-2' : 'sub-all');
      subgBadgeHtml = `<button type="button" class="btn-subgroup-chip ${subClass}" data-subgroup-student="${student.id}" title="Сменить подгруппу студента (нажмите: Вся -> 1-я -> 2-я)">${subLabel}</button>`;
    } else {
      subgBadgeHtml = student.subgroup ? ` <small style="color: var(--hint-color)">[${student.subgroup}п]</small>` : '';
    }

    const quickBtnHtml = isHeadman
      ? `<button type="button" class="btn-row-quick" data-row-student="${student.id}" title="Отметить все пары студента как 'Был'">✅ Все</button>`
      : '';

    let rowHtml = `
      <td class="sticky-col">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(student.fullName)}</span>
          <div style="display: flex; align-items: center; gap: 2px; flex-shrink: 0;">
            ${subgBadgeHtml}
            ${quickBtnHtml}
          </div>
        </div>
      </td>
    `;
    tr.innerHTML = rowHtml;

    // Subgroup chip click listener (cycle: 0 -> 1 -> 2 -> 0)
    const subChipBtn = tr.querySelector(`[data-subgroup-student="${student.id}"]`);
    if (subChipBtn) {
      subChipBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const cur = student.subgroup || 0;
        const nextSub = cur === 0 ? 1 : (cur === 1 ? 2 : 0);
        try {
          await api(`/students/${student.id}/subgroup`, {
            method: 'PATCH',
            body: JSON.stringify({ subgroup: nextSub })
          });
          student.subgroup = nextSub;
          const subNames = { 0: 'Вся группа', 1: '1-я подгруппа', 2: '2-я подгруппа' };
          showToast(`👤 ${student.fullName}: ${subNames[nextSub]}`);
          renderDayTable();
        } catch (err) {
          showToast('Ошибка: ' + err.message);
        }
      });
    }

    // Row action event listener
    const rowQuickBtn = tr.querySelector(`[data-row-student="${student.id}"]`);
    if (rowQuickBtn) {
      rowQuickBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        showToast(`Отмечаю все пары для ${student.fullName}...`);
        for (const l of lessons) {
          if (l.subgroup !== 0 && student.subgroup !== 0 && l.subgroup !== student.subgroup) continue;
          const cell = tr.querySelector(`#cell-${student.id}-${l.id}`);
          await setStudentLessonStatus(student, l, 'present', cell);
        }
        showToast(`✅ ${student.fullName}: все пары отмечены «Был»`);
      });
    }

    // Lesson cells
    lessons.forEach(lesson => {
      const td = document.createElement('td');
      td.id = `cell-${student.id}-${lesson.id}`;

      // Check if lesson is for another subgroup
      if (lesson.subgroup !== 0 && student.subgroup !== 0 && lesson.subgroup !== student.subgroup) {
        td.innerHTML = `<span class="badge-empty" title="Другая подгруппа">—</span>`;
        tr.appendChild(td);
        return;
      }

      const markKey = `${student.id}_${lesson.id}`;
      const mark = marks[markKey];
      const status = mark ? mark.status : 'present';

      if (isHeadman) {
        td.innerHTML = renderInteractiveCellButton(student, lesson, status);
        setupCellEventListeners(td, student, lesson);
      } else {
        td.innerHTML = renderStatusBadge(status);
      }

      tr.appendChild(td);
    });

    // Day total column
    const tdTotal = document.createElement('td');
    tdTotal.className = 'col-day-total';
    tdTotal.id = `day-tot-${student.id}`;
    tdTotal.innerHTML = renderDayTotalPill(student.dayStats);
    tr.appendChild(tdTotal);

    elements.dayTableBody.appendChild(tr);
  });
}

function renderStatusBadge(status) {
  if (status === 'present') {
    return `<span class="badge badge-present">Был</span>`;
  } else if (status === 'absent') {
    return `<span class="badge badge-absent">НБ</span>`;
  } else if (status === 'valid_reason') {
    return `<span class="badge badge-valid">УВ</span>`;
  } else if (status === 'late') {
    return `<span class="badge badge-late">Оп</span>`;
  }
  return `<span class="badge badge-present">Был</span>`;
}

function renderDayTotalPill(dayStats) {
  if (!dayStats || dayStats.totalHoursMissed === 0) {
    return `<span class="day-total-pill perfect">🟢 0ч</span>`;
  }
  return `<span class="day-total-pill missed">🔴 -${dayStats.totalHoursMissed}ч</span>`;
}

function renderDayRoster() {
  if (!state.dayData || !elements.rosterStudentsList) return;

  const { lessons, students, marks } = state.dayData;
  const filterSubgroup = parseInt(elements.daySubgroupFilter?.value || '0', 10);
  const searchQuery = (elements.dayStudentSearch?.value || '').trim().toLowerCase();

  const isHeadman = canEditAttendance();

  // 1. Process all students to gather statistics
  let totalPresentCount = 0;
  let totalAbsentCount = 0;
  let totalValidCount = 0;

  const processedStudents = students.map(student => {
    // Only consider lessons applicable to this student
    const studentLessons = lessons.filter(l => l.subgroup === 0 || student.subgroup === 0 || l.subgroup === student.subgroup);

    const absentLessons = [];
    const validLessons = [];
    const lateLessons = [];
    const pairChips = [];

    studentLessons.forEach(l => {
      const pairSlot = getLessonPairSlot(l, lessons);
      const markKey = `${student.id}_${l.id}`;
      const mark = marks[markKey];
      const status = mark ? mark.status : 'present';
      const note = mark?.note || '';

      if (status === 'absent') absentLessons.push({ lesson: l, pairSlot });
      else if (status === 'valid_reason') validLessons.push({ lesson: l, pairSlot, note });
      else if (status === 'late') lateLessons.push({ lesson: l, pairSlot });

      pairChips.push({
        pairSlot,
        subject: l.subject,
        status,
        lesson: l
      });
    });

    let category = 'present';
    let statusLabel = '🟢 Был на всех парах';
    let statusClass = 'present';

    if (absentLessons.length > 0) {
      category = 'absent';
      const hours = absentLessons.length * 2;
      statusLabel = `🔴 Не был: ${hours} ч. (${absentLessons.length} ${getPairWord(absentLessons.length)})`;
      statusClass = 'absent';
      totalAbsentCount++;
    } else if (validLessons.length > 0) {
      category = 'valid';
      const firstNote = validLessons[0].note ? ` (${validLessons[0].note})` : '';
      statusLabel = `🟡 Уважительная: ${validLessons.length * 2} ч.${firstNote}`;
      statusClass = 'valid';
      totalValidCount++;
    } else {
      totalPresentCount++;
    }

    return {
      student,
      category,
      statusLabel,
      statusClass,
      absentLessons,
      validLessons,
      lateLessons,
      pairChips,
      studentLessons
    };
  });

  // 2. Update Top Counters
  if (elements.rosterCountPresent) elements.rosterCountPresent.textContent = totalPresentCount;
  if (elements.rosterCountAbsent) elements.rosterCountAbsent.textContent = totalAbsentCount;
  if (elements.rosterCountValid) elements.rosterCountValid.textContent = totalValidCount;

  if (elements.countPillAll) elements.countPillAll.textContent = students.length;
  if (elements.countPillAbsent) elements.countPillAbsent.textContent = totalAbsentCount;
  if (elements.countPillValid) elements.countPillValid.textContent = totalValidCount;
  if (elements.countPillPresent) elements.countPillPresent.textContent = totalPresentCount;

  // 3. Filter for display
  const displayStudents = processedStudents.filter(item => {
    const s = item.student;
    // Subgroup filter
    if (filterSubgroup !== 0 && s.subgroup !== 0 && s.subgroup !== filterSubgroup) {
      return false;
    }
    // Search query
    if (searchQuery && !s.fullName.toLowerCase().includes(searchQuery)) {
      return false;
    }
    // Category pill filter
    if (state.rosterFilter !== 'all' && item.category !== state.rosterFilter) {
      return false;
    }
    return true;
  });

  // 4. Render Roster Cards
  elements.rosterStudentsList.innerHTML = '';

  if (displayStudents.length === 0) {
    elements.rosterStudentsList.innerHTML = `
      <div style="text-align: center; padding: 24px; color: var(--hint-color); background: rgba(255,255,255,0.03); border-radius: var(--radius-md);">
        В этой категории студентов не найдено.
      </div>
    `;
    return;
  }

  displayStudents.forEach(item => {
    const { student, category, statusLabel, statusClass, pairChips, studentLessons } = item;
    const card = document.createElement('div');
    const cardBorderClass = category === 'absent' ? 'has-absent' : (category === 'valid' ? 'has-valid' : 'all-present');
    card.className = `roster-student-card ${cardBorderClass}`;

    const subLabel = student.subgroup ? ` <small class="pair-subg-badge sub-${student.subgroup}">${student.subgroup} п/г</small>` : '';

    // Mini pair chips html
    let chipsHtml = '';
    pairChips.forEach(pc => {
      const chipCls = pc.status;
      const statusIcon = pc.status === 'present' ? '🟢' : (pc.status === 'absent' ? '🔴 НБ' : (pc.status === 'valid_reason' ? '🟡 УВ' : '🟠 Оп'));
      chipsHtml += `
        <span class="pair-mini-chip ${chipCls}">
          ${pc.pairSlot} пара (${escapeHtml(pc.subject)}): ${statusIcon}
        </span>
      `;
    });

    // Quick action buttons for headman
    let actionsHtml = '';
    if (isHeadman) {
      actionsHtml = `
        <div class="roster-card-actions">
          <button type="button" class="btn-roster-quick present" data-roster-action="present" data-student-id="${student.id}" title="Отметить все пары как «Был»">
            🟢 Был на всех
          </button>
          <button type="button" class="btn-roster-quick absent" data-roster-action="absent" data-student-id="${student.id}" title="Отметить все пары как «НБ»">
            🔴 НБ на всех
          </button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="roster-card-header">
        <span class="roster-student-name">
          ${escapeHtml(student.fullName)}${subLabel}
        </span>
        <span class="roster-status-pill ${statusClass}">
          ${statusLabel}
        </span>
      </div>
      <div class="roster-pair-pills-row">
        ${chipsHtml}
      </div>
      ${actionsHtml}
    `;

    // Attach listeners for quick buttons
    if (isHeadman) {
      const btnAllPres = card.querySelector('[data-roster-action="present"]');
      const btnAllAbs = card.querySelector('[data-roster-action="absent"]');

      if (btnAllPres) {
        btnAllPres.addEventListener('click', async (e) => {
          e.stopPropagation();
          for (const l of studentLessons) {
            await setStudentLessonStatus(student, l, 'present', null);
          }
          showToast(`✅ ${student.fullName}: все пары отмечены «Был»`);
          renderDayRoster();
        });
      }

      if (btnAllAbs) {
        btnAllAbs.addEventListener('click', async (e) => {
          e.stopPropagation();
          for (const l of studentLessons) {
            await setStudentLessonStatus(student, l, 'absent', null);
          }
          showToast(`🔴 ${student.fullName}: все пары отмечены «НБ»`);
          renderDayRoster();
        });
      }
    }

    elements.rosterStudentsList.appendChild(card);
  });
}

function copyDayReport() {
  if (!state.dayData) {
    showToast('Нет данных за этот день');
    return;
  }

  const { lessons, students, marks } = state.dayData;
  if (!lessons || lessons.length === 0) {
    showToast('В этот день пар нет');
    return;
  }

  const distinctPairSlots = [...new Set(lessons.map(l => getLessonPairSlot(l, lessons)))];
  const totalPairs = distinctPairSlots.length;
  const totalHours = totalPairs * 2;

  const absentLines = [];
  const validLines = [];
  let presentFullCount = 0;

  students.forEach(s => {
    const sLessons = lessons.filter(l => l.subgroup === 0 || s.subgroup === 0 || l.subgroup === s.subgroup);
    const absent = [];
    const valid = [];

    sLessons.forEach(l => {
      const slot = getLessonPairSlot(l, lessons);
      const m = marks[`${s.id}_${l.id}`];
      const st = m ? m.status : 'present';
      if (st === 'absent') {
        absent.push(`${slot}-я пара (${l.subject})`);
      } else if (st === 'valid_reason') {
        valid.push(`${slot}-я пара (${l.subject}${m.note ? ': ' + m.note : ''})`);
      }
    });

    const subgText = s.subgroup ? ` (${s.subgroup} п/г)` : '';

    if (absent.length > 0) {
      absentLines.push(`• ${s.fullName}${subgText} — ${absent.join(', ')} [${absent.length * 2} ч.]`);
    } else if (valid.length > 0) {
      validLines.push(`• ${s.fullName}${subgText} — ${valid.join(', ')}`);
    } else {
      presentFullCount++;
    }
  });

  const [y, m, d] = state.currentDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayName = RU_DAYS[dateObj.getDay()];

  let text = `📅 Рапортичка за ${d} ${RU_MONTHS[m - 1]} (${dayName})\n`;
  text += `🏫 Группа: ${state.user.groupNumber} | ⏱ Пар: ${totalPairs} (${totalHours} ч.)\n\n`;

  if (absentLines.length > 0) {
    text += `🔴 Неуважительные пропуски (НБ — ${absentLines.length} чел.):\n`;
    text += absentLines.join('\n') + '\n\n';
  } else {
    text += `🔴 Неуважительные пропуски (НБ): Все студенты присутствовали! 👏\n\n`;
  }

  if (validLines.length > 0) {
    text += `🟡 Уважительная причина (УВ — ${validLines.length} чел.):\n`;
    text += validLines.join('\n') + '\n\n';
  }

  text += `🟢 Присутствовали на всех парах: ${presentFullCount} из ${students.length} чел.`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('📋 Рапортичка скопирована в буфер!');
    }).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('📋 Рапортичка скопирована в буфер!');
  } catch (e) {
    showToast('Не удалось скопировать в буфер');
  }
  document.body.removeChild(ta);
}

/* ==========================================================================
   2. SUMMARY VIEW (Сводка за семестр)
   ========================================================================== */

async function loadSummaryView() {
  try {
    const summary = await api(`/attendance/summary?groupNumber=${encodeURIComponent(state.user.groupNumber)}`);
    elements.kpiTotalNb.textContent = summary.totalNbHours;
    elements.kpiTotalUv.textContent = summary.totalUvHours;
    elements.kpiTotalMissed.textContent = summary.totalMissedHours;

    const grid = await api(`/attendance/grid?groupNumber=${encodeURIComponent(state.user.groupNumber)}`);
    renderSummaryStudents(grid.students);
  } catch (err) {
    showToast('Ошибка сводки: ' + err.message);
  }
}

function renderSummaryStudents(students) {
  const query = elements.summarySearch.value.trim().toLowerCase();
  elements.summaryStudentsList.innerHTML = '';

  const filtered = students.filter(s => !query || s.fullName.toLowerCase().includes(query));

  filtered.forEach(s => {
    const item = document.createElement('div');
    item.className = 'summary-student-item';
    const subg = s.subgroup ? ` (${s.subgroup} п/г)` : '';

    item.innerHTML = `
      <div>
        <strong>${escapeHtml(s.fullName)}</strong>
        <span style="font-size: 11px; color: var(--hint-color)">${subg}</span>
      </div>
      <div class="summary-hours-box">
        <span class="nb-hours" title="Неуважительные">${s.nbHours} НБ</span>
        <span class="uv-hours" title="Уважительные">${s.uvHours} УВ</span>
        <span class="tot-hours" title="Всего">${s.totalHours} ч.</span>
      </div>
    `;

    elements.summaryStudentsList.appendChild(item);
  });
}

/* ==========================================================================
   3. SCHEDULE VIEW (Расписание недели)
   ========================================================================== */

const DAYS_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

async function loadScheduleView() {
  renderDaySchedule(state.activeScheduleDayIndex);
}

async function renderDaySchedule(dayIndex) {
  elements.scheduleLessonsList.innerHTML = '<div class="loading-state"><div class="spinner"></div>Загрузка...</div>';
  const targetDate = getDateForDayOffset(dayIndex);

  try {
    const data = await api(`/schedule/date?date=${targetDate}&groupNumber=${encodeURIComponent(state.user.groupNumber)}`);
    const lessons = data.lessons || [];

    if (lessons.length === 0) {
      elements.scheduleLessonsList.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--hint-color);">
          🎉 В ${DAYS_NAMES[dayIndex].toLowerCase()} занятий нет!
        </div>
      `;
      return;
    }

    elements.scheduleLessonsList.innerHTML = lessons.map(l => {
      const subg = l.subgroup ? ` [${l.subgroup} п/г]` : '';
      const aud = l.auditory ? ` • Ауд. ${l.auditory}` : '';
      const teacher = l.teacher ? `<div class="sched-sub">👨‍🏫 ${escapeHtml(l.teacher)}</div>` : '';

      return `
        <div class="sched-lesson-item">
          <div class="sched-time">${l.start_time} - ${l.end_time || ''}</div>
          <div class="sched-details">
            <div class="sched-title">${escapeHtml(l.subject)} (${escapeHtml(l.lesson_type)})${subg}</div>
            <div class="sched-sub">${aud}</div>
            ${teacher}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    elements.scheduleLessonsList.innerHTML = `<div>Ошибка: ${err.message}</div>`;
  }
}

function getDateForDayOffset(dayIndex) {
  const now = new Date();
  const currentDay = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const diff = dayIndex - currentDay;
  const target = new Date(now);
  target.setDate(now.getDate() + diff);
  return target.toISOString().split('T')[0];
}

/* ==========================================================================
   4. STUDENTS MANAGEMENT
   ========================================================================== */

async function loadStudentsManage() {
  try {
    const students = await api(`/students?groupNumber=${encodeURIComponent(state.user.groupNumber)}`);
    elements.studentsListContainer.innerHTML = '';

    if (students.length === 0) {
      elements.studentsListContainer.innerHTML = `
        <div style="text-align: center; padding: 16px; color: var(--hint-color);">
          Список пуст. Нажмите "Вставить список", чтобы скопировать фамилии из ведомости.
        </div>
      `;
      return;
    }

    students.forEach((s, idx) => {
      const item = document.createElement('div');
      item.className = 'student-manage-item';

      item.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <strong>${idx + 1}. ${escapeHtml(s.full_name)}</strong>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <select class="select-subgroup-change select-control" data-student-id="${s.id}" style="padding: 4px 8px; font-size: 12px; height: 32px; min-width: 110px;">
            <option value="0" ${s.subgroup === 0 ? 'selected' : ''}>Вся группа</option>
            <option value="1" ${s.subgroup === 1 ? 'selected' : ''}>1-я подгруппа</option>
            <option value="2" ${s.subgroup === 2 ? 'selected' : ''}>2-я подгруппа</option>
          </select>
          <button class="btn-small" style="color: var(--accent-rose);" data-del-id="${s.id}" title="Удалить студента">✕</button>
        </div>
      `;

      // Subgroup selector listener
      const subSelect = item.querySelector('.select-subgroup-change');
      subSelect.addEventListener('change', async (e) => {
        const newSub = parseInt(e.target.value, 10);
        try {
          await api(`/students/${s.id}/subgroup`, {
            method: 'PATCH',
            body: JSON.stringify({ subgroup: newSub })
          });
          s.subgroup = newSub;
          const subNames = { 0: 'Вся группа', 1: '1-я подгруппа', 2: '2-я подгруппа' };
          showToast(`👤 ${s.full_name}: ${subNames[newSub]}`);
        } catch (err) {
          showToast('Ошибка: ' + err.message);
        }
      });

      // Delete listener
      item.querySelector('[data-del-id]').addEventListener('click', async () => {
        if (confirm(`Удалить студента ${s.full_name}?`)) {
          await api(`/students/${s.id}`, { method: 'DELETE' });
          loadStudentsManage();
          showToast('Студент удален');
        }
      });

      elements.studentsListContainer.appendChild(item);
    });
  } catch (err) {
    elements.studentsListContainer.innerHTML = `<div>Ошибка: ${err.message}</div>`;
  }
}

/* ==========================================================================
   NAVIGATION & EVENT LISTENERS
   ========================================================================== */

function switchTab(tabName) {
  state.activeTab = tabName;

  elements.navTabs.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
  });

  Object.keys(elements.views).forEach(key => {
    if (elements.views[key]) {
      elements.views[key].classList.toggle('active', key === tabName);
    }
  });

  if (tabName === 'day') {
    loadDayAttendance();
  } else if (tabName === 'summary') {
    loadSummaryView();
  } else if (tabName === 'schedule') {
    loadScheduleView();
  } else if (tabName === 'students') {
    loadStudentsManage();
  }
}

function setupEventListeners() {
  // Navigation tabs
  elements.navTabs.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.getAttribute('data-tab'));
    });
  });

  // Prev / Next day buttons
  elements.btnPrevDay.addEventListener('click', () => {
    const [y, m, day] = state.currentDate.split('-').map(Number);
    const d = new Date(y, m - 1, day, 12, 0, 0);
    d.setDate(d.getDate() - 1);
    state.currentDate = toLocalDateString(d);
    updateDateDisplay();
    renderQuickDaysStrip();
    loadDayAttendance();
  });

  elements.btnNextDay.addEventListener('click', () => {
    const [y, m, day] = state.currentDate.split('-').map(Number);
    const d = new Date(y, m - 1, day, 12, 0, 0);
    d.setDate(d.getDate() + 1);
    state.currentDate = toLocalDateString(d);
    updateDateDisplay();
    renderQuickDaysStrip();
    loadDayAttendance();
  });

  // Native Date Picker change
  elements.nativeDatePicker.addEventListener('change', (e) => {
    if (e.target.value) {
      state.currentDate = e.target.value;
      updateDateDisplay();
      renderQuickDaysStrip();
      loadDayAttendance();
    }
  });

  // Day View Mode Toggle (Таблица пар vs Кто был/не был)
  if (elements.btnModeTable) {
    elements.btnModeTable.addEventListener('click', () => {
      state.dayViewMode = 'table';
      elements.btnModeTable.classList.add('active');
      if (elements.btnModeRoster) elements.btnModeRoster.classList.remove('active');
      renderDayView();
    });
  }

  if (elements.btnModeRoster) {
    elements.btnModeRoster.addEventListener('click', () => {
      state.dayViewMode = 'roster';
      elements.btnModeRoster.classList.add('active');
      if (elements.btnModeTable) elements.btnModeTable.classList.remove('active');
      renderDayView();
    });
  }

  // Copy Daily Report to clipboard
  if (elements.btnCopyDayReport) {
    elements.btnCopyDayReport.addEventListener('click', copyDayReport);
  }

  // Roster Filter Pills
  document.querySelectorAll('.btn-roster-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-roster-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.rosterFilter = btn.dataset.filter || 'all';
      renderDayRoster();
    });
  });

  // Filters (update active view: table or roster)
  elements.daySubgroupFilter.addEventListener('change', renderDayView);
  elements.dayStudentSearch.addEventListener('input', renderDayView);
  elements.summarySearch.addEventListener('input', () => {
    const grid = api(`/attendance/grid?groupNumber=${encodeURIComponent(state.user.groupNumber)}`).then(g => renderSummaryStudents(g.students));
  });

  // Mark all present on day
  elements.btnDayAllPresent.addEventListener('click', async () => {
    try {
      await api('/attendance/day/all-present', {
        method: 'POST',
        body: JSON.stringify({
          date: state.currentDate,
          groupNumber: state.user.groupNumber
        })
      });
      showToast('✅ Все отмечены присутствующими!');
      loadDayAttendance();
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  });

  // CSV Export
  elements.btnExportCsv.addEventListener('click', () => {
    window.location.href = `/api/attendance/export?groupNumber=${encodeURIComponent(state.user.groupNumber)}`;
  });

  // Sync BSUIR Schedule
  elements.btnSyncBsuir.addEventListener('click', async () => {
    showToast('Синхронизация с ИИС БГУИР...');
    try {
      await api('/group/sync-bsuir', {
        method: 'POST',
        body: JSON.stringify({ groupNumber: state.user.groupNumber })
      });
      showToast('✅ Расписание обновлено');
      loadScheduleView();
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  });

  // Schedule days tabs
  elements.scheduleDaysNav.querySelectorAll('.day-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      elements.scheduleDaysNav.querySelectorAll('.day-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeScheduleDayIndex = parseInt(btn.dataset.day, 10);
      renderDaySchedule(state.activeScheduleDayIndex);
    });
  });

  // Apply for headman button (for students)
  elements.btnApplyHeadman.addEventListener('click', async () => {
    try {
      await api('/headman/apply', {
        method: 'POST',
        body: JSON.stringify({
          telegramId: state.user.telegramId,
          firstName: state.user.firstName,
          username: state.user.username,
          groupNumber: state.user.groupNumber
        })
      });
      showToast('📩 Заявка на старосту отправлена главному старосте!');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  });

  // Change group modal
  elements.btnChangeGroupHeader.addEventListener('click', () => {
    elements.modalGroupInput.value = state.user.groupNumber;
    elements.changeGroupModal.style.display = 'flex';
  });
  elements.btnCloseChangeGroup.addEventListener('click', () => {
    elements.changeGroupModal.style.display = 'none';
  });
  elements.btnCancelChangeGroup.addEventListener('click', () => {
    elements.changeGroupModal.style.display = 'none';
  });
  elements.btnConfirmChangeGroup.addEventListener('click', async () => {
    const grp = elements.modalGroupInput.value.trim();
    if (!/^\d{6}$/.test(grp)) {
      return showToast('Введите 6-значный номер группы');
    }
    try {
      showToast('Подключение группы...');
      await api('/group/set', {
        method: 'POST',
        body: JSON.stringify({ groupNumber: grp })
      });
      state.user.groupNumber = grp;
      elements.changeGroupModal.style.display = 'none';
      await loadGroupInfo();
      loadDayAttendance();
      showToast(`✅ Группа ${grp} подключена!`);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  });

  // Sync students from IIS modal trigger
  const btnSyncStudentsIis = document.getElementById('btnSyncStudentsIis');
  if (btnSyncStudentsIis) {
    btnSyncStudentsIis.addEventListener('click', () => {
      const loginModal = document.getElementById('loginModal');
      if (loginModal) loginModal.style.display = 'flex';
    });
  }

  // Bulk import modal
  elements.btnOpenBulkModal.addEventListener('click', () => { elements.bulkModal.style.display = 'flex'; });
  elements.btnCloseBulkModal.addEventListener('click', () => { elements.bulkModal.style.display = 'none'; });
  elements.btnCancelBulk.addEventListener('click', () => { elements.bulkModal.style.display = 'none'; });

  elements.btnSaveBulk.addEventListener('click', async () => {
    const text = elements.bulkStudentsText.value.trim();
    if (!text) return showToast('Вставьте текст со списком');

    try {
      const res = await api('/students', {
        method: 'POST',
        body: JSON.stringify({
          groupNumber: state.user.groupNumber,
          textList: text
        })
      });
      elements.bulkModal.style.display = 'none';
      elements.bulkStudentsText.value = '';
      loadStudentsManage();
      showToast(`Импортировано: ${res.addedCount} студентов!`);
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  });

  // Add single student
  elements.btnAddSingleStudent.addEventListener('click', async () => {
    const name = elements.newStudentName.value.trim();
    const subgroup = parseInt(elements.newStudentSubgroup.value, 10);
    if (!name) return showToast('Введите ФИО');

    try {
      await api('/students', {
        method: 'POST',
        body: JSON.stringify({
          groupNumber: state.user.groupNumber,
          fullName: name,
          subgroup
        })
      });
      elements.newStudentName.value = '';
      loadStudentsManage();
      showToast('Студент добавлен');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  });

  // Custom subject form
  elements.customSubjectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('customSubjName').value.trim();
    const lessonType = document.getElementById('customSubjType').value;
    const teacher = document.getElementById('customSubjTeacher').value.trim();

    try {
      await api('/custom-subject', {
        method: 'POST',
        body: JSON.stringify({
          groupNumber: state.user.groupNumber,
          name,
          lessonType,
          teacher
        })
      });
      elements.customSubjectForm.reset();
      showToast('Предмет добавлен');
    } catch (err) {
      showToast('Ошибка: ' + err.message);
    }
  });

  // Valid reason (ОРВИ / Справка / Заявление / Мероприятие) modal
  const validReasonModal = document.getElementById('validReasonModal');
  const btnCloseReasonModal = document.getElementById('btnCloseReasonModal');
  const btnCancelReason = document.getElementById('btnCancelReason');
  const btnConfirmReason = document.getElementById('btnConfirmReason');
  const reasonTypeSelect = document.getElementById('reasonTypeSelect');
  const reasonStudentSelect = document.getElementById('reasonStudentSelect');
  const reasonStartDate = document.getElementById('reasonStartDate');
  const reasonEndDate = document.getElementById('reasonEndDate');
  const reasonNote = document.getElementById('reasonNote');
  const modalReasonTitle = document.getElementById('modalReasonTitle');

  // Helper to open reason modal for a specific reason
  function openReasonModal(reasonType = 'ОРВИ', preselectedStudentId = null) {
    if (reasonTypeSelect) reasonTypeSelect.value = reasonType;
    if (reasonStartDate) reasonStartDate.value = state.currentDate;
    if (reasonEndDate) reasonEndDate.value = state.currentDate;

    // Update modal title
    const titles = {
      'ОРВИ': '🤒 Оформление ОРВИ (больничный)',
      'Справка': '📋 Оформление медицинской справки',
      'Заявление': '📝 Оформление заявления',
      'Мероприятие': '🎪 Оформление мероприятия / соревнования'
    };
    if (modalReasonTitle) {
      modalReasonTitle.textContent = titles[reasonType] || '🏥 Оформление уважительной причины';
    }

    // Populate students dropdown
    if (reasonStudentSelect) {
      reasonStudentSelect.innerHTML = '';
      const students = (state.dayData && state.dayData.students) ? state.dayData.students : [];
      if (students.length === 0) {
        reasonStudentSelect.innerHTML = '<option value="">Нет студентов в группе</option>';
      } else {
        students.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = `${s.fullName}${s.subgroup ? ` (${s.subgroup} пг)` : ''}`;
          if (preselectedStudentId && s.id === preselectedStudentId) {
            opt.selected = true;
          } else if (!preselectedStudentId && state.user.studentId && s.id === state.user.studentId) {
            opt.selected = true;
          }
          reasonStudentSelect.appendChild(opt);
        });
      }
    }

    if (reasonNote) {
      const placeholders = {
        'ОРВИ': 'Электронный больничный ИИС БГУИР',
        'Справка': 'напр. Справка №142 от 16.10 (1-я поликлиника)',
        'Заявление': 'напр. Заявление по семейным обстоятельствам в деканат',
        'Мероприятие': 'напр. Участие в хакатоне БГУИР / соревнования'
      };
      reasonNote.placeholder = placeholders[reasonType] || 'Примечание к пропуску';
      reasonNote.value = '';
    }

    if (validReasonModal) {
      validReasonModal.style.display = 'flex';
    }
  }

  // Bind all 4 reason trigger buttons
  document.querySelectorAll('.btn-reason-trigger').forEach(btn => {
    btn.addEventListener('click', () => {
      const reason = btn.getAttribute('data-reason') || 'ОРВИ';
      openReasonModal(reason);
    });
  });

  // Backward compatibility for old button ID if any
  const oldBtnReason = document.getElementById('btnOpenReasonModal');
  if (oldBtnReason) {
    oldBtnReason.addEventListener('click', () => openReasonModal('ОРВИ'));
  }

  // Modal close handlers
  if (btnCloseReasonModal) btnCloseReasonModal.addEventListener('click', () => { validReasonModal.style.display = 'none'; });
  if (btnCancelReason) btnCancelReason.addEventListener('click', () => { validReasonModal.style.display = 'none'; });

  // Quick date chips
  const btnDateToday = document.getElementById('btnDateToday');
  const btnDate3Days = document.getElementById('btnDate3Days');
  const btnDateWeek = document.getElementById('btnDateWeek');

  if (btnDateToday) {
    btnDateToday.addEventListener('click', () => {
      reasonStartDate.value = state.currentDate;
      reasonEndDate.value = state.currentDate;
    });
  }

  if (btnDate3Days) {
    btnDate3Days.addEventListener('click', () => {
      reasonStartDate.value = state.currentDate;
      const [y, m, day] = state.currentDate.split('-').map(Number);
      const d = new Date(y, m - 1, day, 12, 0, 0);
      d.setDate(d.getDate() + 2);
      reasonEndDate.value = toLocalDateString(d);
    });
  }

  if (btnDateWeek) {
    btnDateWeek.addEventListener('click', () => {
      reasonStartDate.value = state.currentDate;
      const [y, m, day] = state.currentDate.split('-').map(Number);
      const d = new Date(y, m - 1, day, 12, 0, 0);
      d.setDate(d.getDate() + 6);
      reasonEndDate.value = toLocalDateString(d);
    });
  }

  // Reason type change listener to update title and placeholder
  if (reasonTypeSelect) {
    reasonTypeSelect.addEventListener('change', () => {
      const r = reasonTypeSelect.value;
      const titles = {
        'ОРВИ': '🤒 Оформление ОРВИ (больничный)',
        'Справка': '📋 Оформление медицинской справки',
        'Заявление': '📝 Оформление заявления',
        'Мероприятие': '🎪 Оформление мероприятия / соревнования'
      };
      if (modalReasonTitle) modalReasonTitle.textContent = titles[r] || '🏥 Оформление уважительной причины';
    });
  }

  if (btnConfirmReason) {
    btnConfirmReason.addEventListener('click', async () => {
      const reasonType = reasonTypeSelect ? reasonTypeSelect.value : 'ОРВИ';
      const startDate = reasonStartDate ? reasonStartDate.value : state.currentDate;
      const endDate = reasonEndDate ? reasonEndDate.value : state.currentDate;
      const note = reasonNote ? reasonNote.value.trim() : '';

      if (!startDate || !endDate) {
        return showToast('Укажите обе даты');
      }

      // Selected student
      let studentId = reasonStudentSelect ? parseInt(reasonStudentSelect.value, 10) : null;
      if (!studentId && state.user.studentId) {
        studentId = state.user.studentId;
      }
      if (!studentId && state.dayData && state.dayData.students.length > 0) {
        studentId = state.dayData.students[0].id;
      }

      if (!studentId) {
        return showToast('Выберите студента из списка');
      }

      try {
        showToast('Оформление уважительной причины...');
        const res = await api('/attendance/valid-reason', {
          method: 'POST',
          body: JSON.stringify({
            studentId,
            reasonType,
            startDate,
            endDate,
            note
          })
        });

        validReasonModal.style.display = 'none';
        showToast(`✅ ${reasonType} оформлено! Проставлено ${res.markedHours} ч. УВ (${res.markedLessonsCount} пар)`);
        await loadDayAttendance();
      } catch (err) {
        showToast('Ошибка: ' + err.message);
      }
    });
  }

  // Login / Auth Modal (IIS Only)
  const loginModal = document.getElementById('loginModal');
  const btnOpenLoginModal = document.getElementById('btnOpenLoginModal');
  const btnCloseLoginModal = document.getElementById('btnCloseLoginModal');
  const btnSubmitIisLogin = document.getElementById('btnSubmitIisLogin');

  if (btnOpenLoginModal) {
    btnOpenLoginModal.addEventListener('click', () => {
      loginModal.style.display = 'flex';
    });
  }
  if (btnCloseLoginModal) btnCloseLoginModal.addEventListener('click', () => { loginModal.style.display = 'none'; });

  if (btnSubmitIisLogin) {
    btnSubmitIisLogin.addEventListener('click', async () => {
      const username = document.getElementById('iisUsernameInput').value.trim();
      const password = document.getElementById('iisPasswordInput').value.trim();
      if (!username || !password) return showToast('Введите логин и пароль ИИС');

      try {
        showToast('Авторизация в ИИС БГУИР...');
        const res = await api('/auth/iis-login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });

        loginModal.style.display = 'none';
        state.user.groupNumber = res.student.group_number;
        state.user.studentId = res.student.id;
        state.user.firstName = res.student.full_name;

        await loadGroupInfo();
        loadDayAttendance();
        showToast(`✅ Добро пожаловать, ${res.student.full_name}!`);
      } catch (err) {
        showToast('Ошибка: ' + err.message);
      }
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}

window.addEventListener('DOMContentLoaded', initApp);
