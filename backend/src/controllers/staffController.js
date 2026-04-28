const { query } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const queueService = require('../services/queueService');
const notify = require('../services/notifyService');
const { logAction } = require('../utils/audit');
const { todayDateStr, currentTimeStr, timeToMinutes } = require('../utils/time');
const { getIO } = require('../sockets/io');

/* -------------------------------------------------------------------------- */
/*  Doctor list (for the doctor selector at the top of the staff view)         */
/* -------------------------------------------------------------------------- */
const listDoctors = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT d.id, d.full_name, d.specialty, dep.name AS department_name
       FROM doctors d
       LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE d.is_active = TRUE
      ORDER BY d.full_name`
  );
  res.json({ doctors: result.rows });
});

/* -------------------------------------------------------------------------- */
/*  Live board (kanban + schedule) for a given doctor + date                   */
/* -------------------------------------------------------------------------- */
const getBoard = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const date = req.query.date || todayDateStr();
  const board = await queueService.getBoard(doctorId, date);
  res.json({ ...board, date, currentTime: currentTimeStr() });
});

/* -------------------------------------------------------------------------- */
/*  Card actions                                                               */
/* -------------------------------------------------------------------------- */
const checkIn = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const updated = await queueService.manualCheckIn(entryId, req.user.profileId);
  await logAction({
    staffId: req.user.profileId,
    appointmentId: updated.appointment_id,
    doctorId: updated.doctor_id,
    action: 'manual_check_in',
    metadata: { arrival_tag: updated.arrival_tag },
  });
  emitBoardUpdate(updated.doctor_id, updated.queue_date);
  await notifyPatientForEntry(entryId, {
    type: 'check_in',
    title: 'You are checked in',
    message: `You're on the list. The clinic will admit you when the doctor is ready.`,
  });
  res.json({ entry: updated });
});

const addToLive = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const updated = await queueService.addToLiveSchedule(entryId, req.user.profileId);
  await logAction({
    staffId: req.user.profileId,
    appointmentId: updated.appointment_id,
    doctorId: updated.doctor_id,
    action: 'add_to_live_schedule',
  });
  emitBoardUpdate(updated.doctor_id, updated.queue_date);
  await notifyPatientForEntry(entryId, {
    type: 'added_to_live_queue',
    title: 'You are in the live queue',
    message: `You are now position #${updated.position} in the live queue.`,
  });
  res.json({ entry: updated });
});

const admit = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const { startTime } = req.body || {};
  const updated = await queueService.admitPatient(entryId, req.user.profileId, startTime);
  await logAction({
    staffId: req.user.profileId,
    appointmentId: updated.appointment_id,
    doctorId: updated.doctor_id,
    action: 'admit_patient',
    metadata: { actual_start_time: updated.actual_start_time },
  });
  emitBoardUpdate(updated.doctor_id, updated.queue_date);
  await notifyPatientForEntry(entryId, {
    type: 'admitted',
    title: '🟢 The doctor is ready for you',
    message: `Please proceed to the consultation room.`,
  });
  res.json({ entry: updated });
});

const complete = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const { endTime, notes } = req.body || {};
  const updated = await queueService.completeVisit(entryId, req.user.profileId, endTime, notes);
  await logAction({
    staffId: req.user.profileId,
    appointmentId: updated.appointment_id,
    doctorId: updated.doctor_id,
    action: 'complete_visit',
    metadata: {
      actual_start_time: updated.actual_start_time,
      actual_end_time: updated.actual_end_time,
    },
  });
  emitBoardUpdate(updated.doctor_id, updated.queue_date);
  await notifyPatientForEntry(entryId, {
    type: 'completed',
    title: 'Your visit is complete',
    message: `Thank you. You can find your visit summary in your account.`,
  });
  res.json({ entry: updated });
});

const reject = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const { reason } = req.body || {};
  const updated = await queueService.rejectPatient(entryId, req.user.profileId, reason);
  await logAction({
    staffId: req.user.profileId,
    appointmentId: updated.appointment_id,
    doctorId: updated.doctor_id,
    action: 'reject_patient',
    metadata: { reason: updated.rejection_reason },
  });
  emitBoardUpdate(updated.doctor_id, updated.queue_date);
  await notifyPatientForEntry(entryId, {
    type: 'rejected',
    title: 'Appointment cannot be processed',
    message: `Reason: ${updated.rejection_reason}. Please speak with reception.`,
  });
  res.json({ entry: updated });
});

const noShow = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const updated = await queueService.markNoShow(entryId, req.user.profileId);
  await logAction({
    staffId: req.user.profileId,
    appointmentId: updated.appointment_id,
    doctorId: updated.doctor_id,
    action: 'no_show',
  });
  emitBoardUpdate(updated.doctor_id, updated.queue_date);
  res.json({ entry: updated });
});

const updateTimes = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const { startTime, endTime } = req.body || {};
  if (!startTime || !endTime) {
    return res.status(400).json({ message: 'startTime and endTime are required.' });
  }
  await queueService.updateEntryTimes(entryId, req.user.profileId, startTime, endTime);
  // Reload to get the post-shift times (may have been adjusted by lock rules).
  const refreshed = await query(
    `SELECT * FROM queue_entries WHERE id = $1`,
    [entryId]
  );
  await logAction({
    staffId: req.user.profileId,
    appointmentId: refreshed.rows[0].appointment_id,
    doctorId: refreshed.rows[0].doctor_id,
    action: 'update_entry_times',
    metadata: { startTime, endTime },
  });
  emitBoardUpdate(refreshed.rows[0].doctor_id, refreshed.rows[0].queue_date);
  await notifyPatientForEntry(entryId, { silent: true });
  res.json({ entry: refreshed.rows[0] });
});

const sendActionRequired = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const { reason, message } = req.body || {};
  const entryRes = await query(
    `SELECT qe.appointment_id, qe.doctor_id, qe.queue_date, a.patient_id, p.user_id
       FROM queue_entries qe
       JOIN appointments  a ON a.id = qe.appointment_id
       JOIN patients      p ON p.id = a.patient_id
      WHERE qe.id = $1`,
    [entryId]
  );
  if (entryRes.rowCount === 0) return res.status(404).json({ message: 'Entry not found.' });
  const e = entryRes.rows[0];

  await query(
    `INSERT INTO notifications (user_id, appointment_id, type, channel, title, message, status, scheduled_at, sent_at)
     VALUES ($1, $2, 'action_required', 'push', $3, $4, 'sent', NOW(), NOW())`,
    [e.user_id, e.appointment_id, reasonTitle(reason), message || reasonMessage(reason)]
  );
  await logAction({
    staffId: req.user.profileId,
    appointmentId: e.appointment_id,
    doctorId: e.doctor_id,
    action: 'action_required_notification',
    metadata: { reason },
  });
  emitBoardUpdate(e.doctor_id, e.queue_date);
  res.json({ ok: true });
});

const globalDelay = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const { delayMinutes, date } = req.body || {};
  const dateStr = date || todayDateStr();
  await queueService.applyGlobalDelay(doctorId, dateStr, parseInt(delayMinutes, 10), req.user.profileId);
  await logAction({
    staffId: req.user.profileId,
    doctorId,
    action: 'global_delay',
    metadata: { delayMinutes, date: dateStr },
  });
  emitBoardUpdate(doctorId, dateStr);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/*  Staff dashboard (summary panel)                                            */
/* -------------------------------------------------------------------------- */
const dashboard = asyncHandler(async (req, res) => {
  const date = req.query.date || todayDateStr();

  // Doctor statuses: derived from queue entries.
  const docs = await query(
    `SELECT
        d.id, d.full_name,
        SUM(CASE WHEN qe.kanban_status = 'in_consultation' THEN 1 ELSE 0 END) AS in_consult,
        SUM(CASE WHEN qe.kanban_status = 'waiting'         THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN qe.kanban_status = 'upcoming'        THEN 1 ELSE 0 END) AS upcoming
       FROM doctors d
       LEFT JOIN queue_entries qe
              ON qe.doctor_id = d.id AND qe.queue_date = $1
      WHERE d.is_active = TRUE
      GROUP BY d.id, d.full_name
      ORDER BY d.full_name`,
    [date]
  );

  // Waiting room totals across all doctors.
  const wr = await query(
    `SELECT
        COUNT(*) FILTER (WHERE kanban_status = 'waiting')                       AS waiting_total,
        COUNT(*) FILTER (WHERE kanban_status = 'waiting' AND arrival_tag='early') AS early,
        COUNT(*) FILTER (WHERE kanban_status = 'waiting' AND arrival_tag='late')  AS late
       FROM queue_entries
      WHERE queue_date = $1`,
    [date]
  );

  // Alerts: long-waiting patients.
  const alerts = await query(
    `SELECT qe.id, p.full_name AS patient_name,
            EXTRACT(EPOCH FROM (NOW() - qe.arrived_at)) / 60 AS waiting_minutes
       FROM queue_entries qe
       JOIN appointments  a ON a.id = qe.appointment_id
       JOIN patients      p ON p.id = a.patient_id
      WHERE qe.queue_date = $1
        AND qe.kanban_status = 'waiting'
        AND qe.arrived_at IS NOT NULL
        AND qe.arrived_at < NOW() - INTERVAL '40 minutes'`,
    [date]
  );

  res.json({
    date,
    doctors: docs.rows,
    waitingRoom: wr.rows[0],
    alerts: alerts.rows,
  });
});

/* -------------------------------------------------------------------------- */
/*  Patient / appointment search (operational data only)                       */
/* -------------------------------------------------------------------------- */
const search = asyncHandler(async (req, res) => {
  const { q, date } = req.query;
  if (!q || q.trim().length < 2) {
    return res.json({ results: [] });
  }
  const term = `%${q.trim()}%`;
  const dateFilter = date ? 'AND s.slot_date = $2' : '';
  const params = date ? [term, date] : [term];

  const result = await query(
    `SELECT
        a.id              AS appointment_id,
        p.full_name       AS patient_name,
        u.phone           AS patient_phone,
        d.full_name       AS doctor_name,
        s.slot_date       AS appointment_date,
        s.start_time      AS appointment_time,
        a.status          AS appointment_status,
        qe.kanban_status,
        qe.arrived_at,
        qe.id             AS queue_entry_id
       FROM appointments a
       JOIN patients     p  ON p.id = a.patient_id
       JOIN users        u  ON u.id = p.user_id
       JOIN doctors      d  ON d.id = a.doctor_id
       JOIN appointment_slots s ON s.id = a.slot_id
       LEFT JOIN queue_entries qe ON qe.appointment_id = a.id
      WHERE (p.full_name ILIKE $1
             OR u.phone ILIKE $1
             OR a.id::text ILIKE $1)
        ${dateFilter}
      ORDER BY s.slot_date DESC, s.start_time DESC
      LIMIT 30`,
    params
  );
  res.json({ results: result.rows });
});

/* -------------------------------------------------------------------------- */
/*  Doctor–staff chat                                                          */
/* -------------------------------------------------------------------------- */
const listChat = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const date = req.query.date || todayDateStr();
  const result = await query(
    `SELECT cm.id, cm.message, cm.quick_action_type, cm.sent_at,
            cm.sender_user_id, u.role AS sender_role,
            CASE
              WHEN u.role = 'doctor' THEN d.full_name
              WHEN u.role = 'staff'  THEN s.full_name
              ELSE u.email
            END AS sender_name
       FROM chat_messages cm
       JOIN users u ON u.id = cm.sender_user_id
       LEFT JOIN doctors d ON d.user_id = u.id
       LEFT JOIN staff   s ON s.user_id = u.id
      WHERE cm.doctor_id = $1 AND cm.session_date = $2
      ORDER BY cm.sent_at ASC`,
    [doctorId, date]
  );
  res.json({ messages: result.rows });
});

const sendChat = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const { message, quickAction } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }
  const result = await query(
    `INSERT INTO chat_messages (doctor_id, sender_user_id, message, quick_action_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, message, quick_action_type, sent_at, sender_user_id`,
    [doctorId, req.user.id, message.trim(), quickAction || null]
  );
  const io = getIO();
  if (io) {
    io.to(`doctor:${doctorId}`).emit('chat:new', {
      ...result.rows[0],
      sender_role: req.user.role,
      sender_name: req.user.fullName,
    });
  }
  res.json({ message: result.rows[0] });
});

/* -------------------------------------------------------------------------- */
/*  End-of-day summary                                                         */
/* -------------------------------------------------------------------------- */
const endOfDay = asyncHandler(async (req, res) => {
  const date = req.query.date || todayDateStr();
  const totals = await query(
    `SELECT
        COUNT(*)                                                AS total,
        COUNT(*) FILTER (WHERE kanban_status = 'completed')     AS completed,
        COUNT(*) FILTER (WHERE arrival_tag = 'late')            AS late,
        COUNT(*) FILTER (WHERE kanban_status = 'no_show')       AS no_show,
        COUNT(*) FILTER (WHERE kanban_status = 'rejected')      AS rejected,
        AVG(EXTRACT(EPOCH FROM (admitted_at - arrived_at)) / 60)
            FILTER (WHERE admitted_at IS NOT NULL AND arrived_at IS NOT NULL)
                                                                AS avg_wait_minutes
       FROM queue_entries
      WHERE queue_date = $1`,
    [date]
  );
  res.json({ date, summary: totals.rows[0] });
});

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */
function reasonTitle(reason) {
  switch (reason) {
    case 'too_late':           return '⚠️ Appointment Status Update';
    case 'too_early':          return "🕒 You're early!";
    case 'schedule_disturbance':return '📢 Schedule Delay Notice';
    default:                   return 'Action Required';
  }
}

function reasonMessage(reason) {
  switch (reason) {
    case 'too_late':
      return 'We noticed you arrived past your scheduled time. Because the clinic is currently full, we cannot automatically admit you. Please proceed to the reception desk to see if we can fit you into a later slot or to reschedule.';
    case 'too_early':
      return 'You have successfully checked in, but your appointment is still several hours away. We currently have no early openings. Please check with the staff to see if a gap in the schedule is expected, or feel free to return closer to your appointment time.';
    case 'schedule_disturbance':
      return 'We apologize, but an unexpected disturbance has occurred in today\'s hospital schedule. We are unable to process your check-in at this moment. Please speak with the receptionist for an update on wait times or to discuss your options.';
    default:
      return 'Please proceed to the reception desk regarding your appointment.';
  }
}

function emitBoardUpdate(doctorId, dateStr) {
  const io = getIO();
  if (!io) return;
  io.to(`board:${doctorId}:${dateStr}`).emit('board:update', { doctorId, date: dateStr });
}

/**
 * Push a live-status update to the patient owning the given queue entry,
 * and optionally write a notifications row.
 *
 * If `silent: true`, only the socket event fires (used for time edits where
 * we want the live tracker to refetch but not nag the patient with a
 * notification entry).
 */
async function notifyPatientForEntry(entryId, payload = {}) {
  try {
    const recipient = await notify.lookupRecipientFromEntry(entryId);
    if (!recipient) return;
    notify.emitStatusUpdate(recipient.patient_id, {
      appointmentId: recipient.appointment_id,
    });
    if (!payload.silent && payload.title && payload.message) {
      await notify.writeNotification({
        userId: recipient.user_id,
        appointmentId: recipient.appointment_id,
        type: payload.type || 'status_update',
        title: payload.title,
        message: payload.message,
      });
    }
  } catch (err) {
    console.error('[notifyPatientForEntry]', err.message);
  }
}

module.exports = {
  listDoctors,
  getBoard,
  checkIn,
  addToLive,
  admit,
  complete,
  reject,
  noShow,
  updateTimes,
  sendActionRequired,
  globalDelay,
  dashboard,
  search,
  listChat,
  sendChat,
  endOfDay,
};
