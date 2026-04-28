/**
 * Doctor Controller
 * ----------------------------------------------------------------------------
 * Doctor perspective. Reuses the existing queueService for the live board and
 * adds:
 *   - Today's dashboard summary
 *   - Read-mostly board view scoped to the logged-in doctor
 *   - Complete-visit action (the only kanban transition the doctor performs)
 *   - Patient detail view (medical profile + history of past visits with this
 *     doctor)
 *   - Consultation records (one per appointment) and prescriptions
 *   - Profile management (biography, fees, etc. — admin still controls
 *     department + active status)
 *   - Schedule management: weekly recurring windows + day-off / unavailability
 *
 * Security:
 *   - Every endpoint requires authenticate + requireRole('doctor').
 *   - All reads/writes are scoped to req.user.profileId (the doctor's id) so
 *     a doctor cannot touch another doctor's data even if they guess ids.
 */

const { query, getClient } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const queueService = require('../services/queueService');
const notify = require('../services/notifyService');
const { logAction } = require('../utils/audit');
const { todayDateStr, currentTimeStr } = require('../utils/time');
const { getIO } = require('../sockets/io');

const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/* ========================================================================== */
/*  Dashboard                                                                  */
/* ========================================================================== */
const dashboard = asyncHandler(async (req, res) => {
  const today = todayDateStr();
  const doctorId = req.user.profileId;

  const stats = await query(
    `SELECT
       COUNT(*)                                                  AS total_today,
       COUNT(*) FILTER (WHERE qe.kanban_status = 'completed')    AS completed,
       COUNT(*) FILTER (WHERE qe.kanban_status = 'in_consultation') AS in_consult,
       COUNT(*) FILTER (WHERE qe.kanban_status = 'waiting')      AS waiting,
       COUNT(*) FILTER (WHERE qe.kanban_status = 'upcoming')     AS upcoming
     FROM queue_entries qe
     WHERE qe.doctor_id = $1 AND qe.queue_date = $2`,
    [doctorId, today]
  );

  // Next patient = first non-completed by scheduled order.
  const nextRes = await query(
    `SELECT qe.id, qe.scheduled_start_time, qe.kanban_status,
            p.full_name AS patient_name
       FROM queue_entries qe
       JOIN appointments a ON a.id = qe.appointment_id
       JOIN patients p ON p.id = a.patient_id
      WHERE qe.doctor_id = $1
        AND qe.queue_date = $2
        AND qe.kanban_status IN ('upcoming', 'waiting', 'in_consultation')
      ORDER BY qe.scheduled_start_time ASC
      LIMIT 1`,
    [doctorId, today]
  );

  res.json({
    today,
    stats: stats.rows[0],
    next: nextRes.rows[0] || null,
  });
});

/* ========================================================================== */
/*  Today's queue (board)                                                      */
/* ========================================================================== */
const getBoard = asyncHandler(async (req, res) => {
  const date = req.query.date || todayDateStr();
  const board = await queueService.getBoard(req.user.profileId, date);
  res.json({ ...board, date, currentTime: currentTimeStr() });
});

/* ========================================================================== */
/*  Complete a visit (the only queue transition the doctor performs)          */
/* ========================================================================== */
const completeVisit = asyncHandler(async (req, res) => {
  const { entryId } = req.params;
  const { endTime, notes } = req.body || {};

  // Verify the entry belongs to this doctor before doing anything.
  const own = await query(
    'SELECT doctor_id FROM queue_entries WHERE id = $1',
    [entryId]
  );
  if (own.rowCount === 0) return res.status(404).json({ message: 'Queue entry not found.' });
  if (own.rows[0].doctor_id !== req.user.profileId) {
    return res.status(403).json({ message: 'You can only complete your own visits.' });
  }

  const updated = await queueService.completeVisit(
    entryId,
    null /* staff_id is null for doctor-driven completion */,
    endTime,
    notes
  );

  await logAction({
    doctorId: req.user.profileId,
    appointmentId: updated.appointment_id,
    action: 'doctor_complete_visit',
    metadata: {
      actual_start_time: updated.actual_start_time,
      actual_end_time: updated.actual_end_time,
    },
  });

  // Mirror the staff socket emit so the kanban refreshes and the patient
  // banner updates.
  const io = getIO();
  if (io) {
    io.to(`board:${updated.doctor_id}:${updated.queue_date}`)
      .emit('board:update', { doctorId: updated.doctor_id, date: updated.queue_date });
  }

  // Notify the patient.
  try {
    const recipient = await notify.lookupRecipientFromEntry(entryId);
    if (recipient) {
      notify.emitStatusUpdate(recipient.patient_id, { appointmentId: recipient.appointment_id });
      await notify.writeNotification({
        userId: recipient.user_id,
        appointmentId: recipient.appointment_id,
        type: 'completed',
        title: 'Your visit is complete',
        message: 'Thank you. You can find your visit summary in your account.',
      });
    }
  } catch { /* non-fatal */ }

  res.json({ entry: updated });
});

/* ========================================================================== */
/*  Patient information for a specific appointment                             */
/* ========================================================================== */

/**
 * Return the patient's profile + medical info + history of completed visits
 * with THIS doctor. The doctor can only see profiles for patients they have
 * (or had) an appointment with.
 */
const getPatientForAppointment = asyncHandler(async (req, res) => {
  const { appointmentId } = req.params;
  const doctorId = req.user.profileId;

  // Ownership check: appointment must be with this doctor.
  const apptRes = await query(
    `SELECT a.id, a.patient_id, a.status, a.visit_type,
            s.slot_date, s.start_time
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE a.id = $1 AND a.doctor_id = $2`,
    [appointmentId, doctorId]
  );
  if (apptRes.rowCount === 0) {
    return res.status(404).json({ message: 'Appointment not found.' });
  }
  const appt = apptRes.rows[0];

  // Patient profile
  const profileRes = await query(
    `SELECT p.id, p.full_name,
            p.allergies, p.chronic_conditions, p.current_medications, p.blood_type,
            p.insurance_provider, p.insurance_number,
            p.emergency_contact_name, p.emergency_contact_phone,
            u.email, u.phone
       FROM patients p
       JOIN users u ON u.id = p.user_id
      WHERE p.id = $1`,
    [appt.patient_id]
  );

  // History of past visits with this doctor (excluding the current appointment).
  const historyRes = await query(
    `SELECT a.id, a.status, a.visit_type,
            s.slot_date, s.start_time,
            cr.symptoms, cr.diagnosis, cr.treatment_plan, cr.recommendations,
            cr.followup_recommended
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
       LEFT JOIN consultation_records cr ON cr.appointment_id = a.id
      WHERE a.patient_id = $1 AND a.doctor_id = $2 AND a.id <> $3
      ORDER BY s.slot_date DESC, s.start_time DESC
      LIMIT 20`,
    [appt.patient_id, doctorId, appointmentId]
  );

  // Existing consultation record + prescriptions for this very appointment, if any.
  const consultRes = await query(
    `SELECT id, symptoms, diagnosis, treatment_plan, recommendations,
            followup_recommended, followup_by_date, recorded_at, updated_at
       FROM consultation_records
      WHERE appointment_id = $1`,
    [appointmentId]
  );
  const consultation = consultRes.rows[0] || null;

  let prescriptions = [];
  if (consultation) {
    const rxRes = await query(
      `SELECT id, medication_name, dosage, instructions, issued_date, valid_until
         FROM prescriptions
        WHERE consultation_id = $1
        ORDER BY issued_date DESC`,
      [consultation.id]
    );
    prescriptions = rxRes.rows;
  }

  res.json({
    appointment: appt,
    profile: profileRes.rows[0] || null,
    history: historyRes.rows,
    consultation,
    prescriptions,
  });
});

/* ========================================================================== */
/*  Consultation records & prescriptions                                       */
/* ========================================================================== */

/**
 * Save (insert or update) the consultation record for an appointment.
 * Body: { symptoms, diagnosis, treatmentPlan, recommendations,
 *         followupRecommended, followupByDate }
 *
 * Validation: if followupRecommended is true, followupByDate is required
 * (the schema CHECK constraint enforces this too — we surface a friendly
 * error before hitting the DB).
 */
const saveConsultation = asyncHandler(async (req, res) => {
  const { appointmentId } = req.params;
  const {
    symptoms, diagnosis, treatmentPlan, recommendations,
    followupRecommended, followupByDate,
  } = req.body || {};

  // Ownership.
  const apptRes = await query(
    'SELECT id, patient_id FROM appointments WHERE id = $1 AND doctor_id = $2',
    [appointmentId, req.user.profileId]
  );
  if (apptRes.rowCount === 0) {
    return res.status(404).json({ message: 'Appointment not found.' });
  }

  if (followupRecommended && !followupByDate) {
    return res.status(400).json({
      message: 'A follow-up date is required when follow-up is recommended.',
    });
  }

  // UPSERT — schema enforces UNIQUE(appointment_id).
  const result = await query(
    `INSERT INTO consultation_records
       (appointment_id, doctor_id, symptoms, diagnosis, treatment_plan,
        recommendations, followup_recommended, followup_by_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (appointment_id) DO UPDATE
       SET symptoms             = EXCLUDED.symptoms,
           diagnosis            = EXCLUDED.diagnosis,
           treatment_plan       = EXCLUDED.treatment_plan,
           recommendations      = EXCLUDED.recommendations,
           followup_recommended = EXCLUDED.followup_recommended,
           followup_by_date     = EXCLUDED.followup_by_date,
           updated_at           = NOW()
     RETURNING id`,
    [
      appointmentId, req.user.profileId,
      symptoms || null, diagnosis || null, treatmentPlan || null, recommendations || null,
      !!followupRecommended,
      followupRecommended ? followupByDate : null,
    ]
  );

  await logAction({
    doctorId: req.user.profileId,
    appointmentId,
    action: 'doctor_save_consultation',
  });

  res.json({ consultationId: result.rows[0].id });
});

const addPrescription = asyncHandler(async (req, res) => {
  const { consultationId } = req.params;
  const { medicationName, dosage, instructions, validUntil } = req.body || {};

  if (!medicationName || !dosage) {
    return res.status(400).json({ message: 'Medication name and dosage are required.' });
  }

  // Ownership: consultation must belong to this doctor.
  const consRes = await query(
    `SELECT cr.id, cr.doctor_id, a.patient_id
       FROM consultation_records cr
       JOIN appointments a ON a.id = cr.appointment_id
      WHERE cr.id = $1 AND cr.doctor_id = $2`,
    [consultationId, req.user.profileId]
  );
  if (consRes.rowCount === 0) {
    return res.status(404).json({ message: 'Consultation record not found.' });
  }

  const result = await query(
    `INSERT INTO prescriptions
       (consultation_id, doctor_id, patient_id, medication_name, dosage, instructions, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, medication_name, dosage, instructions, issued_date, valid_until`,
    [
      consultationId,
      req.user.profileId,
      consRes.rows[0].patient_id,
      medicationName.trim(),
      dosage.trim(),
      instructions || null,
      validUntil || null,
    ]
  );

  await logAction({
    doctorId: req.user.profileId,
    action: 'doctor_add_prescription',
    metadata: { consultationId, medication: medicationName },
  });

  res.status(201).json({ prescription: result.rows[0] });
});

const deletePrescription = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Ownership.
  const own = await query(
    'SELECT id FROM prescriptions WHERE id = $1 AND doctor_id = $2',
    [id, req.user.profileId]
  );
  if (own.rowCount === 0) return res.status(404).json({ message: 'Prescription not found.' });

  await query('DELETE FROM prescriptions WHERE id = $1', [id]);
  res.json({ ok: true });
});

/* ========================================================================== */
/*  Profile (self)                                                             */
/* ========================================================================== */
const getMyProfile = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT d.id, d.full_name, d.specialty, d.qualifications, d.biography,
            d.standard_fee, d.followup_fee, d.appointment_duration_minutes,
            d.is_active, d.department_id,
            dep.name AS department_name,
            u.email, u.phone
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE d.id = $1`,
    [req.user.profileId]
  );
  if (result.rowCount === 0) return res.status(404).json({ message: 'Profile not found.' });
  res.json({ profile: result.rows[0] });
});

const updateMyProfile = asyncHandler(async (req, res) => {
  const {
    fullName, specialty, qualifications, biography,
    standardFee, followupFee, appointmentDurationMinutes,
    phone,
  } = req.body || {};

  const docRes = await query('SELECT user_id FROM doctors WHERE id = $1', [req.user.profileId]);
  if (docRes.rowCount === 0) return res.status(404).json({ message: 'Profile not found.' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE doctors
          SET full_name = COALESCE($1, full_name),
              specialty = COALESCE($2, specialty),
              qualifications = $3,
              biography = $4,
              standard_fee = COALESCE($5, standard_fee),
              followup_fee = COALESCE($6, followup_fee),
              appointment_duration_minutes = COALESCE($7, appointment_duration_minutes),
              updated_at = NOW()
        WHERE id = $8`,
      [
        fullName ? fullName.trim() : null,
        specialty ? specialty.trim() : null,
        qualifications || null,
        biography || null,
        standardFee,
        followupFee,
        appointmentDurationMinutes,
        req.user.profileId,
      ]
    );
    if (phone !== undefined) {
      await client.query(
        `UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2`,
        [phone || null, docRes.rows[0].user_id]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* ========================================================================== */
/*  Schedule management                                                        */
/* ========================================================================== */

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * Returns the doctor's weekly schedule + any unavailability rows ahead of today.
 */
const getMySchedule = asyncHandler(async (req, res) => {
  const sched = await query(
    `SELECT id, day_of_week, start_time, end_time, is_active
       FROM doctor_schedules
      WHERE doctor_id = $1
      ORDER BY ARRAY_POSITION($2::text[], day_of_week::text)`,
    [req.user.profileId, DAYS]
  );

  const unav = await query(
    `SELECT id, unavailable_date, block_start_time, block_end_time, is_full_day, reason
       FROM doctor_unavailabilities
      WHERE doctor_id = $1 AND unavailable_date >= CURRENT_DATE
      ORDER BY unavailable_date ASC`,
    [req.user.profileId]
  );

  res.json({ weekly: sched.rows, unavailabilities: unav.rows });
});

/**
 * Replace the doctor's full weekly schedule in one transaction.
 * Body: { weekly: [{ day_of_week, start_time, end_time, is_active }, ...] }
 *
 * Schema enforces UNIQUE(doctor_id, day_of_week) so we can safely DELETE
 * existing rows and re-INSERT. Days not present in the payload simply have
 * no row (i.e., not working that day).
 */
const updateMySchedule = asyncHandler(async (req, res) => {
  const { weekly } = req.body || {};
  if (!Array.isArray(weekly)) {
    return res.status(400).json({ message: 'weekly must be an array.' });
  }
  // Validate all rows up front.
  for (const row of weekly) {
    if (!DAYS.includes(row.day_of_week)) {
      return res.status(400).json({ message: `Invalid day_of_week: ${row.day_of_week}` });
    }
    if (!row.start_time || !row.end_time) {
      return res.status(400).json({ message: 'start_time and end_time are required.' });
    }
    if (row.start_time >= row.end_time) {
      return res.status(400).json({ message: `Invalid window for ${row.day_of_week}: end must be after start.` });
    }
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM doctor_schedules WHERE doctor_id = $1', [req.user.profileId]);
    for (const row of weekly) {
      await client.query(
        `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, is_active)
         VALUES ($1, $2::day_of_week, $3, $4, $5)`,
        [
          req.user.profileId,
          row.day_of_week,
          row.start_time,
          row.end_time,
          row.is_active === false ? false : true,
        ]
      );
    }
    await client.query('COMMIT');
    await logAction({ doctorId: req.user.profileId, action: 'doctor_update_schedule' });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * Add a doctor unavailability (day off or partial block).
 * Body: { date, isFullDay, startTime?, endTime?, reason? }
 */
const addUnavailability = asyncHandler(async (req, res) => {
  const { date, isFullDay, startTime, endTime, reason } = req.body || {};
  if (!date) return res.status(400).json({ message: 'date is required.' });

  if (!isFullDay && (!startTime || !endTime)) {
    return res.status(400).json({ message: 'Partial blocks need start and end times.' });
  }
  if (!isFullDay && startTime >= endTime) {
    return res.status(400).json({ message: 'End time must be after start time.' });
  }

  const result = await query(
    `INSERT INTO doctor_unavailabilities
       (doctor_id, unavailable_date, block_start_time, block_end_time, is_full_day, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, unavailable_date, block_start_time, block_end_time, is_full_day, reason`,
    [
      req.user.profileId,
      date,
      isFullDay ? null : startTime,
      isFullDay ? null : endTime,
      !!isFullDay,
      reason || null,
    ]
  );

  await logAction({
    doctorId: req.user.profileId,
    action: 'doctor_add_unavailability',
    metadata: { date, isFullDay },
  });

  res.status(201).json({ unavailability: result.rows[0] });
});

const removeUnavailability = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const own = await query(
    'SELECT id FROM doctor_unavailabilities WHERE id = $1 AND doctor_id = $2',
    [id, req.user.profileId]
  );
  if (own.rowCount === 0) return res.status(404).json({ message: 'Not found.' });
  await query('DELETE FROM doctor_unavailabilities WHERE id = $1', [id]);
  res.json({ ok: true });
});

/* ========================================================================== */
/*  Doctor↔Staff chat (mirror of the staff side)                              */
/* ========================================================================== */

const QUICK_ACTIONS = ['running_late', 'ready_for_next', 'pause_queue', 'resume_queue'];

const listChat = asyncHandler(async (req, res) => {
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
    [req.user.profileId, date]
  );
  res.json({ messages: result.rows });
});

const sendChat = asyncHandler(async (req, res) => {
  const { message, quickAction } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }
  if (quickAction && !QUICK_ACTIONS.includes(quickAction)) {
    return res.status(400).json({ message: 'Invalid quick action.' });
  }

  const result = await query(
    `INSERT INTO chat_messages (doctor_id, sender_user_id, message, quick_action_type)
     VALUES ($1, $2, $3, $4)
     RETURNING id, message, quick_action_type, sent_at, sender_user_id`,
    [req.user.profileId, req.user.id, message.trim(), quickAction || null]
  );
  const io = getIO();
  if (io) {
    io.to(`doctor:${req.user.profileId}`).emit('chat:new', {
      ...result.rows[0],
      sender_role: req.user.role,
      sender_name: req.user.fullName,
    });
  }
  res.json({ message: result.rows[0] });
});

module.exports = {
  dashboard,
  getBoard,
  completeVisit,
  getPatientForAppointment,
  saveConsultation, addPrescription, deletePrescription,
  getMyProfile, updateMyProfile,
  getMySchedule, updateMySchedule,
  addUnavailability, removeUnavailability,
  listChat, sendChat,
};
