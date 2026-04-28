/**
 * Patient Controller
 * ----------------------------------------------------------------------------
 * Patient-facing HTTP handlers:
 *   - Registration (creates user + patient row in a transaction)
 *   - Profile view + update
 *   - Doctor browsing (departments, list, profile)
 *   - Slot availability + booking flow with the 3-minute reservation hold
 *   - "My Appointments" list with cancellation policy enforcement
 *   - Online payment (test mode — flips payment_status to 'online_paid')
 *   - Notifications inbox
 *
 * Security:
 *   - All endpoints (except register) require authenticate + requireRole('patient').
 *   - Every read of an appointment/profile is scoped to the logged-in patient
 *     so one user cannot read another's data.
 */

const bcrypt = require('bcryptjs');
const { query, getClient } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const slotService = require('../services/slotService');
const { todayDateStr, currentTimeStr } = require('../utils/time');

const PASSWORD_MIN = 6;

const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/* ========================================================================== */
/*  Registration                                                               */
/* ========================================================================== */

/**
 * POST /api/auth/register
 * Mounted on the auth router so it's reachable without a token.
 *
 * Required: email, password, fullName, phone
 * Optional medical: allergies, chronicConditions, currentMedications,
 *                   bloodType, insuranceProvider, insurancePolicyNumber,
 *                   emergencyContactName, emergencyContactPhone,
 *                   gender, dateOfBirth
 *
 * Returns the same shape as /auth/login on success: { token, user }
 */
const register = asyncHandler(async (req, res) => {
  const {
    email, password, fullName, phone,
    allergies, chronicConditions, currentMedications, bloodType,
    insuranceProvider, insuranceNumber,
    emergencyContactName, emergencyContactPhone,
  } = req.body || {};

  if (!email || !password || !fullName) {
    return res.status(400).json({ message: 'Email, password, and full name are required.' });
  }
  if (password.length < PASSWORD_MIN) {
    return res.status(400).json({ message: `Password must be at least ${PASSWORD_MIN} characters.` });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ message: 'Invalid email format.' });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (existing.rowCount > 0) {
    return res.status(409).json({ message: 'An account with that email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, phone, role)
       VALUES ($1, $2, $3, 'patient') RETURNING id`,
      [email.toLowerCase().trim(), passwordHash, phone || null]
    );
    const patientRes = await client.query(
      `INSERT INTO patients
         (user_id, full_name,
          allergies, chronic_conditions, current_medications, blood_type,
          insurance_provider, insurance_number,
          emergency_contact_name, emergency_contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, full_name`,
      [
        userRes.rows[0].id,
        fullName.trim(),
        allergies || null,
        chronicConditions || null,
        currentMedications || null,
        bloodType || null,
        insuranceProvider || null,
        insuranceNumber || null,
        emergencyContactName || null,
        emergencyContactPhone || null,
      ]
    );
    await client.query('COMMIT');

    const token = signToken({
      id: userRes.rows[0].id,
      email: email.toLowerCase().trim(),
      role: 'patient',
      profileId: patientRes.rows[0].id,
      fullName: patientRes.rows[0].full_name,
    });

    res.status(201).json({
      token,
      user: {
        id: userRes.rows[0].id,
        email: email.toLowerCase().trim(),
        role: 'patient',
        profileId: patientRes.rows[0].id,
        fullName: patientRes.rows[0].full_name,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* ========================================================================== */
/*  Profile                                                                    */
/* ========================================================================== */

const getProfile = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT p.id, p.full_name,
            p.allergies, p.chronic_conditions, p.current_medications, p.blood_type,
            p.insurance_provider, p.insurance_number,
            p.emergency_contact_name, p.emergency_contact_phone,
            u.email, u.phone
       FROM patients p JOIN users u ON u.id = p.user_id
      WHERE p.id = $1`,
    [req.user.profileId]
  );
  if (result.rowCount === 0) return res.status(404).json({ message: 'Profile not found.' });
  res.json({ profile: result.rows[0] });
});

const updateProfile = asyncHandler(async (req, res) => {
  const {
    fullName, phone,
    allergies, chronicConditions, currentMedications, bloodType,
    insuranceProvider, insuranceNumber,
    emergencyContactName, emergencyContactPhone,
  } = req.body || {};

  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE patients
          SET full_name = COALESCE($1, full_name),
              allergies = $2,
              chronic_conditions = $3,
              current_medications = $4,
              blood_type = $5,
              insurance_provider = $6,
              insurance_number = $7,
              emergency_contact_name = $8,
              emergency_contact_phone = $9,
              updated_at = NOW()
        WHERE id = $10`,
      [
        fullName ? fullName.trim() : null,
        allergies || null,
        chronicConditions || null,
        currentMedications || null,
        bloodType || null,
        insuranceProvider || null,
        insuranceNumber || null,
        emergencyContactName || null,
        emergencyContactPhone || null,
        req.user.profileId,
      ]
    );

    if (phone !== undefined) {
      await client.query(
        `UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2`,
        [phone || null, req.user.id]
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
/*  Doctor browsing                                                            */
/* ========================================================================== */

const listDepartments = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, name, description FROM departments
      WHERE is_active = TRUE
      ORDER BY name`
  );
  res.json({ departments: result.rows });
});

const listDoctors = asyncHandler(async (req, res) => {
  const { departmentId } = req.query;
  const params = [];
  let where = 'd.is_active = TRUE';
  if (departmentId) {
    params.push(departmentId);
    where += ` AND d.department_id = $${params.length}`;
  }
  const result = await query(
    `SELECT d.id, d.full_name, d.specialty, d.qualifications, d.biography,
            d.standard_fee, d.followup_fee, d.appointment_duration_minutes,
            dep.name AS department_name, dep.id AS department_id
       FROM doctors d
       LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE ${where}
      ORDER BY d.full_name`,
    params
  );
  res.json({ doctors: result.rows });
});

const getDoctor = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await query(
    `SELECT d.id, d.full_name, d.specialty, d.qualifications, d.biography,
            d.standard_fee, d.followup_fee, d.appointment_duration_minutes,
            dep.name AS department_name, dep.id AS department_id
       FROM doctors d
       LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE d.id = $1 AND d.is_active = TRUE`,
    [id]
  );
  if (result.rowCount === 0) return res.status(404).json({ message: 'Doctor not found.' });
  res.json({ doctor: result.rows[0] });
});

/* ========================================================================== */
/*  Slot availability                                                          */
/* ========================================================================== */

const getDoctorSlots = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;
  if (!date) return res.status(400).json({ message: 'date query parameter required.' });
  const result = await slotService.getSlotsForDay(id, date);
  res.json({ date, ...result });
});

/* ========================================================================== */
/*  Booking flow                                                               */
/* ========================================================================== */

/**
 * Step 1 of booking: hold a slot for 3 minutes while the patient confirms.
 * POST /api/patient/holds
 * Body: { doctorId, date, startTime, endTime }
 * Returns: { slotId, holdMinutes, expiresAt }
 */
const holdSlot = asyncHandler(async (req, res) => {
  const { doctorId, date, startTime, endTime } = req.body || {};
  if (!doctorId || !date || !startTime || !endTime) {
    return res.status(400).json({ message: 'doctorId, date, startTime, endTime are required.' });
  }
  const result = await slotService.holdSlot(
    doctorId, date, startTime, endTime, req.user.profileId
  );
  res.json({
    slotId: result.slotId,
    holdMinutes: result.holdMinutes,
    expiresAt: new Date(Date.now() + result.holdMinutes * 60 * 1000).toISOString(),
  });
});

/**
 * Release a held slot (patient cancelled before confirming).
 * DELETE /api/patient/holds/:slotId
 */
const releaseHold = asyncHandler(async (req, res) => {
  await slotService.releaseHold(req.params.slotId, req.user.profileId);
  res.json({ ok: true });
});

/**
 * Step 2 of booking: confirm. Promotes a held slot to 'booked' and creates
 * the appointment record. Computes whether this is a follow-up (within
 * 2 months of a completed visit with the same doctor) and applies the
 * reduced fee accordingly.
 *
 * POST /api/patient/appointments
 * Body: { slotId, paymentMethod }   (paymentMethod: 'online' | 'cash')
 */
const bookAppointment = asyncHandler(async (req, res) => {
  const { slotId, paymentMethod } = req.body || {};
  if (!slotId) return res.status(400).json({ message: 'slotId is required.' });
  if (!['online', 'cash'].includes(paymentMethod)) {
    return res.status(400).json({ message: 'paymentMethod must be "online" or "cash".' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the slot row.
    const slotRes = await client.query(
      `SELECT id, doctor_id, slot_date, start_time, end_time, status,
              reserved_by_patient_id, reservation_expires_at
         FROM appointment_slots
        WHERE id = $1
        FOR UPDATE`,
      [slotId]
    );
    if (slotRes.rowCount === 0) throw httpError(404, 'Slot not found.');
    const slot = slotRes.rows[0];

    if (slot.status === 'booked') throw httpError(409, 'This slot is no longer available.');
    if (slot.status === 'reserved' && slot.reserved_by_patient_id !== req.user.profileId) {
      throw httpError(409, 'This slot is held by another patient.');
    }
    if (slot.reservation_expires_at && new Date(slot.reservation_expires_at) < new Date()) {
      throw httpError(410, 'Your reservation expired. Please pick the slot again.');
    }

    // Detect follow-up: completed appointment with same doctor within last 2 months.
    const followupRes = await client.query(
      `SELECT 1 FROM appointments a
         JOIN appointment_slots s ON s.id = a.slot_id
        WHERE a.patient_id = $1
          AND a.doctor_id = $2
          AND a.status = 'completed'
          AND s.slot_date >= (CURRENT_DATE - INTERVAL '2 months')
        LIMIT 1`,
      [req.user.profileId, slot.doctor_id]
    );
    const isFollowup = followupRes.rowCount > 0;

    // Fetch the right fee.
    const docRes = await client.query(
      `SELECT standard_fee, followup_fee FROM doctors WHERE id = $1`,
      [slot.doctor_id]
    );
    const fee = isFollowup
      ? Number(docRes.rows[0].followup_fee) || Number(docRes.rows[0].standard_fee)
      : Number(docRes.rows[0].standard_fee);

    // Promote the slot to 'booked'.
    await client.query(
      `UPDATE appointment_slots
          SET status = 'booked',
              reserved_by_patient_id = NULL,
              reservation_expires_at = NULL
        WHERE id = $1`,
      [slotId]
    );

    // Determine payment status. The schema's payment_status enum is
    //   'unpaid' | 'online_paid' | 'cash_paid' | 'refunded'
    // For both flows we start as 'unpaid'. Online flow flips to 'online_paid'
    // once /payments/:id completes; cash flow flips to 'cash_paid' when staff
    // collects payment at the desk.
    const paymentStatus = 'unpaid';

    // Build the scheduled_at timestamp in JS rather than asking Postgres to
    // concatenate the slot_date + start_time. The pg driver returns DATE
    // columns as JS Date objects; when fed back into a SQL `||` operator
    // Postgres serializes them as full ISO strings (2026-04-28T00:00:00+03:00),
    // which combined with ' ' + '09:00:00' produces an invalid timestamp.
    // Formatting locally bypasses that round-trip entirely.
    const d = new Date(slot.slot_date);
    const ymd = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
    const scheduledAtStr = `${ymd} ${slot.start_time}`;

    // Create the appointment.
    const apptRes = await client.query(
      `INSERT INTO appointments
         (patient_id, doctor_id, slot_id, visit_type, status,
          payment_status, payment_method, fee_charged, scheduled_at)
       VALUES ($1, $2, $3, $4, 'confirmed', $5, $6, $7, $8::timestamp)
       RETURNING id`,
      [
        req.user.profileId,
        slot.doctor_id,
        slotId,
        isFollowup ? 'follow_up' : 'new_consultation',
        paymentStatus,
        paymentMethod,
        fee,
        scheduledAtStr,
      ]
    );
    const apptId = apptRes.rows[0].id;

    // Confirmation notification.
    await client.query(
      `INSERT INTO notifications
         (user_id, appointment_id, type, channel, title, message, status, scheduled_at, sent_at)
       VALUES ($1, $2, 'booking_confirmed', 'push', 'Appointment confirmed',
               'Your appointment has been booked. See My Appointments for details.',
               'sent', NOW(), NOW())`,
      [req.user.id, apptId]
    );

    await client.query('COMMIT');
    res.status(201).json({
      appointmentId: apptId,
      visitType: isFollowup ? 'follow_up' : 'new_consultation',
      fee,
      paymentStatus,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/* ========================================================================== */
/*  My Appointments                                                            */
/* ========================================================================== */

const listMyAppointments = asyncHandler(async (req, res) => {
  // Uses the same join pattern as the staff search endpoint.
  const result = await query(
    `SELECT a.id, a.visit_type, a.status, a.payment_status, a.payment_method,
            a.fee_charged, a.scheduled_at,
            s.slot_date, s.start_time, s.end_time,
            d.id AS doctor_id, d.full_name AS doctor_name, d.specialty,
            dep.name AS department_name,
            qe.kanban_status, qe.position, qe.arrival_tag,
            qe.arrived_at, qe.admitted_at, qe.consultation_end_at
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN departments dep ON dep.id = d.department_id
       LEFT JOIN queue_entries qe ON qe.appointment_id = a.id
      WHERE a.patient_id = $1
      ORDER BY s.slot_date DESC, s.start_time DESC`,
    [req.user.profileId]
  );
  res.json({ appointments: result.rows });
});

/**
 * Cancel an appointment.
 * Per spec: only allowed at least 24h before scheduled_at.
 */
const cancelAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const apptRes = await query(
    `SELECT a.id, a.status, a.slot_id, a.scheduled_at, a.payment_status
       FROM appointments a
      WHERE a.id = $1 AND a.patient_id = $2`,
    [id, req.user.profileId]
  );
  if (apptRes.rowCount === 0) return res.status(404).json({ message: 'Appointment not found.' });
  const a = apptRes.rows[0];

  if (['completed', 'cancelled', 'no_show'].includes(a.status)) {
    return res.status(400).json({ message: 'This appointment cannot be cancelled.' });
  }

  const hoursAhead = (new Date(a.scheduled_at) - new Date()) / (1000 * 60 * 60);
  if (hoursAhead < 24) {
    return res.status(403).json({
      message: 'Cancellations must be made at least 24 hours before the appointment.',
    });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE appointments SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [id]
    );
    // Free up the slot for someone else.
    await client.query(
      `DELETE FROM appointment_slots WHERE id = $1`,
      [a.slot_id]
    );
    // Inform the patient (and add a hint if they paid online).
    const refundNote = a.payment_status === 'online_paid'
      ? ' Please contact the hospital to arrange your refund.'
      : '';
    await client.query(
      `INSERT INTO notifications
         (user_id, appointment_id, type, channel, title, message, status, scheduled_at, sent_at)
       VALUES ($1, $2, 'cancelled', 'push', 'Appointment cancelled',
               $3, 'sent', NOW(), NOW())`,
      [req.user.id, id, `Your appointment has been cancelled.${refundNote}`]
    );
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
/*  Payment (test mode)                                                        */
/* ========================================================================== */

/**
 * Marks an appointment as paid online. This is a SIMULATED payment endpoint —
 * it doesn't talk to a real PSP. The frontend collects card details, posts
 * here, and we just flip payment_status to 'online_paid'. Intentional —
 * real payments need their own integration story.
 */
const payAppointment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const apptRes = await query(
    `SELECT a.id, a.status, a.payment_status, a.payment_method
       FROM appointments a WHERE a.id = $1 AND a.patient_id = $2`,
    [id, req.user.profileId]
  );
  if (apptRes.rowCount === 0) return res.status(404).json({ message: 'Appointment not found.' });
  const a = apptRes.rows[0];
  if (a.status === 'cancelled') {
    return res.status(400).json({ message: 'Cannot pay for a cancelled appointment.' });
  }
  if (a.payment_status === 'online_paid') {
    return res.status(400).json({ message: 'This appointment is already paid.' });
  }

  // Insert a payment record + flip the status.
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO payments (appointment_id, amount, method, status, processed_at)
       VALUES ($1, (SELECT fee_charged FROM appointments WHERE id = $1), 'online', 'completed', NOW())`,
      [id]
    );
    await client.query(
      `UPDATE appointments
          SET payment_status = 'online_paid', payment_method = 'online', updated_at = NOW()
        WHERE id = $1`,
      [id]
    );
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
/*  Live status & self check-in                                                */
/* ========================================================================== */

/**
 * Returns the patient's currently-active or upcoming-today appointment along
 * with their queue position, expected start time, and overall progress stage.
 * Used by the MyAppointments live-tracker banner.
 *
 * "Active" = appointment for today that hasn't been completed/cancelled/no-show.
 * If no active appointment exists, returns { active: null }.
 */
const getLiveStatus = asyncHandler(async (req, res) => {
  const today = todayDateStr();

  const apptRes = await query(
    `SELECT a.id              AS appointment_id,
            a.status,
            d.id              AS doctor_id,
            d.full_name       AS doctor_name,
            d.specialty,
            s.slot_date,
            s.start_time,
            qe.id             AS queue_entry_id,
            qe.kanban_status,
            qe.arrival_tag,
            qe.position,
            qe.scheduled_start_time,
            qe.scheduled_end_time,
            qe.actual_start_time,
            qe.arrived_at,
            qe.admitted_at,
            qe.consultation_end_at
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN queue_entries qe ON qe.appointment_id = a.id
      WHERE a.patient_id = $1
        AND s.slot_date = $2
        AND a.status NOT IN ('cancelled', 'no_show')
      ORDER BY s.start_time ASC
      LIMIT 1`,
    [req.user.profileId, today]
  );

  if (apptRes.rowCount === 0) {
    return res.json({ active: null });
  }
  const me = apptRes.rows[0];

  // If already on the live queue, count how many cards are ahead.
  let aheadCount = 0;
  if (me.position != null) {
    const ahead = await query(
      `SELECT COUNT(*)::int AS n FROM queue_entries
        WHERE doctor_id = $1
          AND queue_date = $2
          AND kanban_status IN ('waiting', 'in_consultation')
          AND position IS NOT NULL
          AND position < $3`,
      [me.doctor_id, today, me.position]
    );
    aheadCount = ahead.rows[0].n;
  }

  // Stage maps to the patient's progress bar (Checked-In → Waiting →
  // In Consultation → Done). 'pending' covers the pre-arrival state.
  let stage = 'pending';
  if (me.kanban_status === 'waiting')         stage = 'waiting';
  else if (me.kanban_status === 'in_consultation') stage = 'in_consultation';
  else if (me.kanban_status === 'completed')  stage = 'completed';
  else if (me.kanban_status === 'rejected')   stage = 'rejected';

  res.json({
    active: {
      ...me,
      stage,
      ahead_count: aheadCount,
    },
  });
});

/**
 * Patient self check-in. Finds the patient's queue entry for their today
 * appointment and runs the same check-in flow that staff would trigger
 * manually. This is a deliberate one-click replacement for the QR-based
 * check-in described in the spec.
 *
 * Validations:
 *   - Patient must own an appointment today that is in 'upcoming' kanban
 *     status (i.e., not yet checked in, not yet admitted, not cancelled).
 *
 * After success the staff kanban will reflect the new arrival via the
 * existing socket emit; the patient's own live-status will refresh via
 * `patient:status`.
 */
const selfCheckIn = asyncHandler(async (req, res) => {
  const today = todayDateStr();

  const entryRes = await query(
    `SELECT qe.id, qe.kanban_status, qe.doctor_id, qe.queue_date,
            qe.scheduled_start_time, a.id AS appointment_id, a.status
       FROM queue_entries qe
       JOIN appointments  a ON a.id = qe.appointment_id
      WHERE a.patient_id = $1
        AND qe.queue_date = $2
        AND a.status NOT IN ('cancelled', 'no_show', 'completed')
      ORDER BY qe.scheduled_start_time ASC
      LIMIT 1`,
    [req.user.profileId, today]
  );

  if (entryRes.rowCount === 0) {
    return res.status(404).json({
      message: 'No active appointment for today found.',
    });
  }
  const entry = entryRes.rows[0];

  if (entry.kanban_status !== 'upcoming') {
    return res.status(400).json({
      message: 'You are already checked in.',
    });
  }

  // Reuse the staff queueService directly. It handles arrival_tag computation
  // and the kanban transition; the staff socket room is also notified by
  // queueService callers, but since the patient is invoking it, we trigger
  // the board event here by hand.
  const queueService = require('../services/queueService');
  const { getIO } = require('../sockets/io');
  const notify = require('../services/notifyService');

  // Use the patient's user id as the staff_id for audit purposes — actually
  // the schema requires staff_id to reference staff(id), and we can't pass a
  // patient id there. Pass null so the action is recorded as a self check-in.
  const updated = await queueService.manualCheckIn(entry.id, null);

  // Emit the staff board update so the kanban refreshes.
  const io = getIO();
  if (io) {
    io.to(`board:${updated.doctor_id}:${updated.queue_date}`)
      .emit('board:update', { doctorId: updated.doctor_id, date: updated.queue_date });
  }

  // Confirm to the patient.
  notify.emitStatusUpdate(req.user.profileId, {
    appointmentId: updated.appointment_id,
  });
  await notify.writeNotification({
    userId: req.user.id,
    appointmentId: updated.appointment_id,
    type: 'check_in',
    title: 'You are checked in',
    message: 'Welcome! You are now in the waiting room.',
  });

  res.json({ entry: updated });
});

const listNotifications = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, type, title, message, status, sent_at
       FROM notifications
      WHERE user_id = $1
      ORDER BY COALESCE(sent_at, scheduled_at) DESC
      LIMIT 50`,
    [req.user.id]
  );
  res.json({ notifications: result.rows });
});

module.exports = {
  // Auth-adjacent
  register,
  // Profile
  getProfile, updateProfile,
  // Browsing
  listDepartments, listDoctors, getDoctor, getDoctorSlots,
  // Booking
  holdSlot, releaseHold, bookAppointment,
  // My appointments
  listMyAppointments, cancelAppointment,
  // Payments
  payAppointment,
  // Live status & self check-in
  getLiveStatus, selfCheckIn,
  // Notifications
  listNotifications,
};
