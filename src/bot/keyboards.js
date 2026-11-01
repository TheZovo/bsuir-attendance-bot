import { Keyboard, InlineKeyboard } from 'grammy';
import { config } from '../config.js';

/**
 * Inline keyboard to open Mini App with fallback browser link
 */
export function getAppInlineKeyboard(webAppUrl = config.webAppUrl) {
  return new InlineKeyboard()
    .webApp('🚀 Открыть Журнал посещаемости', webAppUrl)
    .row()
    .url('🌐 Открыть в браузере (на телефоне)', webAppUrl);
}

/**
 * Main menu keyboard for Headman (Староста)
 */
export function getHeadmanMenu(webAppUrl = config.webAppUrl) {
  return new Keyboard()
    .webApp('📱 Открыть Журнал посещаемости', webAppUrl)
    .row()
    .text('📋 Отметить пару')
    .text('👥 Кто был сегодня')
    .row()
    .text('📊 Мои пропуски')
    .text('📅 Расписание')
    .row()
    .text('👥 Список группы')
    .text('🏥 Оформить ОРВИ / Справку')
    .row()
    .text('⚙️ Управление группой')
    .resized();
}

/**
 * Main menu keyboard for Student (Студент)
 */
export function getStudentMenu(webAppUrl = config.webAppUrl) {
  return new Keyboard()
    .webApp('📱 Открыть Мой Журнал', webAppUrl)
    .row()
    .text('👥 Кто был сегодня')
    .text('📊 Мои пропуски')
    .row()
    .text('📅 Расписание')
    .text('🏥 Оформить ОРВИ / Справку')
    .row()
    .text('🔑 Войти через ИИС')
    .text('📩 Подать заявку на старосту')
    .resized();
}

/**
 * Registration choices keyboard (IIS only)
 */
export function getRegistrationKeyboard() {
  return new InlineKeyboard()
    .text('🔑 Войти через ИИС БГУИР', 'reg:iis');
}

/**
 * Valid reason type keyboard
 */
export function getValidReasonTypeKeyboard() {
  return new InlineKeyboard()
    .text('🤒 ОРВИ (ИИС БГУИР)', 'reason_type:ОРВИ')
    .text('📋 Справка', 'reason_type:Справка')
    .row()
    .text('📝 Заявление', 'reason_type:Заявление')
    .text('🎪 Мероприятие', 'reason_type:Мероприятие');
}

/**
 * Inline keyboard for main headman to approve/reject headman request
 */
export function getHeadmanApprovalKeyboard(requestId) {
  return new InlineKeyboard()
    .text('✅ Одобрить', `approve_headman:${requestId}`)
    .text('❌ Отклонить', `reject_headman:${requestId}`);
}

/**
 * Keyboard for selecting today's lesson to mark
 */
export function getLessonSelectionKeyboard(lessons) {
  const keyboard = new InlineKeyboard();

  if (!lessons || lessons.length === 0) {
    return keyboard.text('🔄 Обновить расписание', 'sync_schedule');
  }

  for (const l of lessons) {
    const subg = l.subgroup ? ` (${l.subgroup} п/г)` : '';
    keyboard.text(
      `🕒 ${l.startTime} | ${l.subject} (${l.lessonType})${subg}`,
      `mark_lesson:${l.id}`
    ).row();
  }

  return keyboard;
}

/**
 * In-chat interactive attendance marking keyboard for a lesson
 */
export function getLessonMarkingKeyboard(lessonId, students, currentMarks = {}) {
  const keyboard = new InlineKeyboard();

  for (const s of students) {
    const mark = currentMarks[s.id] || 'present';
    let icon = '🟢'; // present
    let label = 'Был';

    if (mark === 'absent') {
      icon = '🔴';
      label = 'НБ';
    } else if (mark === 'valid_reason') {
      icon = '🟡';
      label = 'УВ';
    } else if (mark === 'late') {
      icon = '⚪';
      label = 'Опоздал';
    }

    // Toggle button: clicking cycles: present -> absent -> valid_reason -> present
    keyboard.text(`${icon} ${s.fullName} (${label})`, `toggle_mark:${lessonId}:${s.id}`).row();
  }

  // Action buttons
  keyboard
    .text('✅ Все были', `all_present:${lessonId}`)
    .text('💾 Готово', `finish_mark:${lessonId}`)
    .row()
    .url('📱 Открыть в Mini App', `${config.webAppUrl}?lessonId=${lessonId}`);

  return keyboard;
}

/**
 * Group management keyboard
 */
export function getGroupSettingsKeyboard() {
  return new InlineKeyboard()
    .text('🔄 Синхронизировать расписание ИИС', 'admin:sync_bsuir')
    .row()
    .text('👥 Синхронизировать студентов из ИИС', 'admin:sync_iis_students')
    .row()
    .text('➕ Добавить студентов списком', 'admin:bulk_students')
    .row()
    .text('🏫 Изменить номер группы', 'admin:change_group')
    .row()
    .text('🗑 Очистить список группы', 'admin:clear_students');
}
