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
       JOIN staff_doctor_assignments sda ON sda.doctor_id = d.id
       LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE d.is_active = TRUE
        AND sda.staff_id = $1
      ORDER BY d.full_name`
    ,
    [req.user.profileId]
  );
  res.json({ doctors: result.rows });
});

/* -------------------------------------------------------------------------- */
/*  Live board (kanban + schedule) for a given doctor + date                   */
/* -------------------------------------------------------------------------- */
const getBoard = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const date = req.query.date || todayDateStr();
  await assertStaffCanAccessDoctor(req.user.profileId, doctorId);
  const board = await queueService.getBoard(doctorId, date);
  await notifyNewLateUpcomingEntries(board.entries, date);
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
  if (updated.arrival_tag === 'late') {
    await notifyPatientForEntry(entryId, {
      type: 'too_late',
      title: 'You are late for your appointment',
      message: 'You arrived after your scheduled time. Your live queue tracker is paused. Please contact staff to see whether you can be fit into another position today.',
      email: true,
    });
  } else {
    await notifyPatientForEntry(entryId, { silent: true });
  }
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
  await notifyActiveTimelinePatientsForDoctorDay(updated.doctor_id, updated.queue_date, { silent: true });
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
  await notifyActiveTimelinePatientsForDoctorDay(updated.doctor_id, updated.queue_date, { silent: true });
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
  await notifyActiveTimelinePatientsForDoctorDay(updated.doctor_id, updated.queue_date, { silent: true });
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
  await notifyPatientForEntry(entryId, { silent: true });
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

  await notifyPatientsByAppointmentIds([e.appointment_id], {
    type: 'action_required',
    title: reasonTitle(reason),
    message: message || reasonMessage(reason),
    email: reason === 'too_late' || reason === 'schedule_disturbance',
  });
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
  const parsedDelay = parseInt(delayMinutes, 10);
  await queueService.applyGlobalDelay(doctorId, dateStr, parsedDelay, req.user.profileId);
  await logAction({
    staffId: req.user.profileId,
    doctorId,
    action: 'global_delay',
    metadata: { delayMinutes: parsedDelay, date: dateStr },
  });
  emitBoardUpdate(doctorId, dateStr);
  res.json({ ok: true });
});

const cancelRemainingDay = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const { date, message } = req.body || {};
  const dateStr = date || todayDateStr();
  await assertStaffCanAccessDoctor(req.user.profileId, doctorId);
  const liveRecipients = await query(
    `SELECT qe.appointment_id
       FROM queue_entries qe
       JOIN appointments a ON a.id = qe.appointment_id
      WHERE qe.doctor_id = $1
        AND qe.queue_date = $2
        AND qe.kanban_status IN ('waiting', 'in_consultation')
        AND qe.position IS NOT NULL
        AND a.status NOT IN ('completed', 'cancelled', 'no_show')`,
    [doctorId, dateStr]
  );
  const rows = await query(
    `UPDATE queue_entries qe
        SET kanban_status = 'rejected',
            rejection_reason = 'Doctor emergency - day cancelled',
            position = NULL,
            staff_id = $3,
            updated_at = NOW()
       FROM appointments a
      WHERE a.id = qe.appointment_id
        AND qe.doctor_id = $1
        AND qe.queue_date = $2
        AND qe.kanban_status IN ('upcoming', 'waiting', 'in_consultation')
      RETURNING qe.id, qe.appointment_id`,
    [doctorId, dateStr, req.user.profileId]
  );
  if (rows.rowCount > 0) {
    await query(
      `UPDATE appointments
          SET status = 'cancelled', updated_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [rows.rows.map((r) => r.appointment_id)]
    );
  }
  await logAction({
    staffId: req.user.profileId,
    doctorId,
    action: 'cancel_remaining_day',
    metadata: { date: dateStr, affected: rows.rowCount },
  });
  emitBoardUpdate(doctorId, dateStr);
  await notifyPatientsByAppointmentIds(liveRecipients.rows.map((r) => r.appointment_id), {
    type: 'cancelled',
    title: 'Today appointment cancelled',
    message: message || 'The doctor has an emergency and cannot continue today. Please book another day.',
    email: true,
  });
  res.json({ ok: true, affectedCount: rows.rowCount });
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
       JOIN staff_doctor_assignments sda ON sda.doctor_id = d.id
       LEFT JOIN queue_entries qe
              ON qe.doctor_id = d.id AND qe.queue_date = $1
      WHERE d.is_active = TRUE
        AND sda.staff_id = $2
      GROUP BY d.id, d.full_name
      ORDER BY d.full_name`,
    [date, req.user.profileId]
  );

  // Waiting room totals across all doctors.
  const wr = await query(
    `SELECT
        COUNT(*) FILTER (WHERE kanban_status = 'waiting')                       AS waiting_total,
        COUNT(*) FILTER (WHERE kanban_status = 'waiting' AND arrival_tag='early') AS early,
        COUNT(*) FILTER (WHERE kanban_status = 'waiting' AND arrival_tag='late')  AS late
       FROM queue_entries
      WHERE queue_date = $1
        AND doctor_id IN (
          SELECT doctor_id FROM staff_doctor_assignments WHERE staff_id = $2
        )`,
    [date, req.user.profileId]
  );

  // Alerts: long-waiting patients.
  const alerts = await query(
    `SELECT qe.id, p.full_name AS patient_name,
            EXTRACT(EPOCH FROM (NOW() - qe.arrived_at)) / 60 AS waiting_minutes
       FROM queue_entries qe
       JOIN appointments  a ON a.id = qe.appointment_id
       JOIN patients      p ON p.id = a.patient_id
      WHERE qe.queue_date = $1
        AND qe.doctor_id IN (
          SELECT doctor_id FROM staff_doctor_assignments WHERE staff_id = $2
        )
        AND qe.kanban_status = 'waiting'
        AND qe.arrived_at IS NOT NULL
        AND qe.arrived_at < NOW() - INTERVAL '40 minutes'`,
    [date, req.user.profileId]
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
/*  Patient <-> staff communication                                            */
/* -------------------------------------------------------------------------- */
const listPatientConversations = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT c.id, c.patient_id, c.appointment_id, c.assigned_staff_id,
            c.subject, c.status, c.last_message_at, c.created_at,
            p.full_name AS patient_name, u.email AS patient_email, u.phone AS patient_phone,
            lm.message AS last_message,
            lm.sent_at AS last_message_sent_at,
            lu.role AS last_sender_role,
            COUNT(um.id)::int AS unread_count
       FROM patient_staff_conversations c
       JOIN patients p ON p.id = c.patient_id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN LATERAL (
         SELECT m.message, m.sent_at, m.sender_user_id
           FROM patient_staff_messages m
          WHERE m.conversation_id = c.id
          ORDER BY m.sent_at DESC
          LIMIT 1
       ) lm ON TRUE
       LEFT JOIN users lu ON lu.id = lm.sender_user_id
       LEFT JOIN patient_staff_messages um
              ON um.conversation_id = c.id
             AND um.read_by_staff_at IS NULL
             AND um.sender_user_id <> $1
      GROUP BY c.id, p.full_name, u.email, u.phone,
               lm.message, lm.sent_at, lu.role
      ORDER BY c.status = 'resolved', c.last_message_at DESC`,
    [req.user.id]
  );
  res.json({ conversations: result.rows });
});

const getPatientConversation = asyncHandler(async (req, res) => {
  const conversation = await loadPatientConversation(req.params.conversationId);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  await query(
    `UPDATE patient_staff_messages
        SET read_by_staff_at = NOW()
      WHERE conversation_id = $1
        AND sender_user_id <> $2
        AND read_by_staff_at IS NULL`,
    [conversation.id, req.user.id]
  );

  const messages = await query(
    `SELECT m.id, m.conversation_id, m.sender_user_id, m.message, m.sent_at,
            u.role AS sender_role,
            CASE
              WHEN u.role = 'patient' THEN p.full_name
              WHEN u.role = 'staff'   THEN s.full_name
              ELSE u.email
            END AS sender_name
       FROM patient_staff_messages m
       JOIN users u ON u.id = m.sender_user_id
       LEFT JOIN patients p ON p.user_id = u.id
       LEFT JOIN staff s ON s.user_id = u.id
      WHERE m.conversation_id = $1
      ORDER BY m.sent_at ASC`,
    [conversation.id]
  );

  res.json({ conversation, messages: messages.rows });
});

const sendPatientConversationMessage = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { message } = req.body || {};
  const trimmed = (message || '').trim();
  if (!trimmed) return res.status(400).json({ message: 'Message cannot be empty.' });
  if (trimmed.length > 2000) {
    return res.status(400).json({ message: 'Message must be 2000 characters or fewer.' });
  }

  const conversation = await loadPatientConversation(conversationId);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  const result = await query(
    `INSERT INTO patient_staff_messages
       (conversation_id, sender_user_id, message, read_by_staff_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, conversation_id, sender_user_id, message, sent_at`,
    [conversationId, req.user.id, trimmed]
  );
  await query(
    `UPDATE patient_staff_conversations
        SET status = 'pending_patient',
            assigned_staff_id = COALESCE(assigned_staff_id, $2),
            last_message_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [conversationId, req.user.profileId]
  );

  const row = {
    ...result.rows[0],
    sender_role: req.user.role,
    sender_name: req.user.fullName,
  };
  emitPatientStaffMessage(conversation, row);
  await notify.writeNotification({
    userId: conversation.patient_user_id,
    appointmentId: conversation.appointment_id,
    type: 'staff_message',
    title: 'Staff replied to your message',
    message: trimmed,
  });
  res.status(201).json({ message: row });
});

const updatePatientConversationStatus = asyncHandler(async (req, res) => {
  const { conversationId } = req.params;
  const { status } = req.body || {};
  if (!['open', 'pending_patient', 'resolved'].includes(status)) {
    return res.status(400).json({ message: 'Invalid conversation status.' });
  }
  const result = await query(
    `UPDATE patient_staff_conversations
        SET status = $1,
            assigned_staff_id = COALESCE(assigned_staff_id, $3),
            updated_at = NOW()
      WHERE id = $2
      RETURNING id, patient_id, appointment_id, assigned_staff_id,
                subject, status, last_message_at, created_at`,
    [status, conversationId, req.user.profileId]
  );
  if (result.rowCount === 0) return res.status(404).json({ message: 'Conversation not found.' });
  const conversation = await loadPatientConversation(conversationId);
  const io = getIO();
  if (io) {
    io.to(`patient_staff:${conversationId}`).emit('patient_staff:status', { conversation });
    io.to(`patient:communication:${conversation.patient_id}`).emit('patient_staff:status', { conversation });
    io.to('staff:communication').emit('patient_staff:status', { conversation });
  }
  res.json({ conversation });
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

async function assertStaffCanAccessDoctor(staffId, doctorId) {
  const access = await query(
    `SELECT 1
       FROM staff_doctor_assignments
      WHERE staff_id = $1 AND doctor_id = $2
      LIMIT 1`,
    [staffId, doctorId]
  );
  if (access.rowCount === 0) {
    const err = new Error('You are not assigned to this doctor.');
    err.status = 403;
    throw err;
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

async function loadPatientConversation(conversationId) {
  const result = await query(
    `SELECT c.id, c.patient_id, c.appointment_id, c.assigned_staff_id,
            c.subject, c.status, c.last_message_at, c.created_at,
            p.full_name AS patient_name,
            u.id AS patient_user_id, u.email AS patient_email, u.phone AS patient_phone
       FROM patient_staff_conversations c
       JOIN patients p ON p.id = c.patient_id
       JOIN users u ON u.id = p.user_id
      WHERE c.id = $1`,
    [conversationId]
  );
  return result.rows[0] || null;
}

function emitPatientStaffMessage(conversation, messageRow) {
  const io = getIO();
  if (!io) return;
  const payload = { conversationId: conversation.id, conversation, message: messageRow };
  io.to(`patient_staff:${conversation.id}`).emit('patient_staff:new', payload);
  io.to(`patient:communication:${conversation.patient_id}`).emit('patient_staff:new', payload);
  io.to('staff:communication').emit('patient_staff:new', payload);
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
    if (payload.email && payload.title && payload.message) {
      await notify.sendEmailSafe({
        to: recipient.email,
        title: payload.title,
        lines: [
          `Doctor: ${recipient.doctor_name}`,
          `Date: ${recipient.appointment_date}`,
          `Time: ${String(recipient.appointment_time || '').slice(0, 5)}`,
          payload.message,
        ],
      });
    }
  } catch (err) {
    console.error('[notifyPatientForEntry]', err.message);
  }
}

async function notifyLivePatientsForDoctorDay(doctorId, dateStr, payload = {}) {
  const result = await query(
    `SELECT qe.appointment_id, p.id AS patient_id, p.full_name AS patient_name,
            u.id AS user_id, u.email,
            d.full_name AS doctor_name,
            s.slot_date::text AS appointment_date,
            s.start_time AS appointment_time
       FROM queue_entries qe
       JOIN appointments a ON a.id = qe.appointment_id
       JOIN patients p ON p.id = a.patient_id
       JOIN users u ON u.id = p.user_id
       JOIN doctors d ON d.id = qe.doctor_id
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE qe.doctor_id = $1
        AND qe.queue_date = $2
        AND qe.kanban_status IN ('waiting', 'in_consultation')
        AND qe.position IS NOT NULL
        AND a.status NOT IN ('completed', 'cancelled', 'no_show')`,
    [doctorId, dateStr]
  );
  await notifyRecipients(result.rows, payload);
}

async function notifyPatientsByAppointmentIds(appointmentIds, payload = {}) {
  if (!appointmentIds.length) return;
  const result = await query(
    `SELECT a.id AS appointment_id, p.id AS patient_id, p.full_name AS patient_name,
            u.id AS user_id, u.email,
            d.full_name AS doctor_name,
            s.slot_date::text AS appointment_date,
            s.start_time AS appointment_time
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN users u ON u.id = p.user_id
       JOIN doctors d ON d.id = a.doctor_id
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE a.id = ANY($1::uuid[])`,
    [appointmentIds]
  );
  await notifyRecipients(result.rows, payload);
}

async function notifyActiveTimelinePatientsForDoctorDay(doctorId, dateStr, payload = {}) {
  const result = await query(
    `SELECT qe.appointment_id, p.id AS patient_id, p.full_name AS patient_name,
            u.id AS user_id, u.email,
            d.full_name AS doctor_name,
            s.slot_date::text AS appointment_date,
            s.start_time AS appointment_time
       FROM queue_entries qe
       JOIN appointments a ON a.id = qe.appointment_id
       JOIN patients p ON p.id = a.patient_id
       JOIN users u ON u.id = p.user_id
       JOIN doctors d ON d.id = qe.doctor_id
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE qe.doctor_id = $1
        AND qe.queue_date = $2
        AND qe.kanban_status IN ('upcoming', 'waiting', 'in_consultation')
        AND NOT (qe.kanban_status = 'waiting' AND qe.arrival_tag = 'late' AND qe.position IS NULL)
        AND a.status NOT IN ('completed', 'cancelled', 'no_show')`,
    [doctorId, dateStr]
  );
  await notifyRecipients(result.rows, payload);
}

async function notifyRecipients(recipients, payload = {}) {
  for (const recipient of recipients) {
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
    if (payload.email && payload.title && payload.message) {
      await notify.sendEmailSafe({
        to: recipient.email,
        title: payload.title,
        lines: [
          `Doctor: ${recipient.doctor_name}`,
          `Date: ${recipient.appointment_date}`,
          `Time: ${String(recipient.appointment_time || '').slice(0, 5)}`,
          payload.message,
        ],
      });
    }
  }
}

async function notifyNewLateUpcomingEntries(entries, dateStr) {
  if (dateStr !== todayDateStr()) return;
  const nowMin = timeToMinutes(currentTimeStr());
  const lateEntries = (entries || []).filter((entry) => {
    if (entry.kanban_status !== 'upcoming') return false;
    const original = entry.original_scheduled_start || entry.scheduled_start_time;
    return nowMin - timeToMinutes(original) > 10;
  });
  for (const entry of lateEntries) {
    const existing = await query(
      `SELECT 1
         FROM notifications
        WHERE appointment_id = $1
          AND type = 'too_late'
        LIMIT 1`,
      [entry.appointment_id]
    );
    if (existing.rowCount > 0) continue;
    const message = 'You are too late for your appointment. Your live queue tracker is paused. Please contact staff to see whether you can be fit into another position today.';
    await notify.writeNotification({
      userId: entry.patient_user_id,
      appointmentId: entry.appointment_id,
      type: 'too_late',
      title: 'You are too late for your appointment',
      message,
    });
    await notify.sendEmailSafe({
      to: entry.patient_email,
      title: 'You are too late for your appointment',
      lines: [
        `Patient: ${entry.patient_name}`,
        `Date: ${dateStr}`,
        `Scheduled time: ${String(entry.original_scheduled_start || entry.scheduled_start_time || '').slice(0, 5)}`,
        message,
      ],
    });
    notify.emitStatusUpdate(entry.patient_id, { appointmentId: entry.appointment_id });
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
  cancelRemainingDay,
  dashboard,
  search,
  listChat,
  sendChat,
  endOfDay,
  listPatientConversations,
  getPatientConversation,
  sendPatientConversationMessage,
  updatePatientConversationStatus,
};
