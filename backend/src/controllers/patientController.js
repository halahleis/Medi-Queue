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
const { todayDateStr, currentTimeStr, timeToMinutes, minutesToTime } = require('../utils/time');
const { validatePassword, validatePhone } = require('../utils/validation');
const { getIO } = require('../sockets/io');

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
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });
  const phoneError = validatePhone(phone);
  if (phoneError) return res.status(400).json({ message: phoneError });
  const emergencyPhoneError = validatePhone(emergencyContactPhone);
  if (emergencyPhoneError) return res.status(400).json({ message: `Emergency contact ${emergencyPhoneError.charAt(0).toLowerCase()}${emergencyPhoneError.slice(1)}` });
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

  const phoneError = validatePhone(phone);
  if (phoneError) return res.status(400).json({ message: phoneError });
  const emergencyPhoneError = validatePhone(emergencyContactPhone);
  if (emergencyPhoneError) return res.status(400).json({ message: `Emergency contact ${emergencyPhoneError.charAt(0).toLowerCase()}${emergencyPhoneError.slice(1)}` });

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
      `SELECT id, doctor_id, slot_date::text AS slot_date, start_time, end_time, status,
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

    // Prevent duplicate same-doctor visits on the same day and overlapping
    // visits with any doctor. Different doctors on the same day are allowed
    // when their appointment windows do not overlap.
    // Keep DATE values as plain YYYY-MM-DD strings; converting through JS Date
    // shifts days in timezones ahead of UTC.
    const slotDateStr = slot.slot_date;
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
      [req.user.profileId, slotDateStr]
    );
    await slotService.assertPatientCanBookSlot(
      req.user.profileId,
      slot.doctor_id,
      slotDateStr,
      slot.start_time,
      slot.end_time,
      client
    );

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
    const scheduledAtStr = `${slotDateStr} ${slot.start_time}`;

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

    await client.query(
      `INSERT INTO queue_entries
         (appointment_id, queue_date, doctor_id, scheduled_start_time, scheduled_end_time, kanban_status)
       VALUES ($1, $2::date, $3, $4, $5, 'upcoming')
       ON CONFLICT (appointment_id) DO NOTHING`,
      [apptId, slotDateStr, slot.doctor_id, slot.start_time, slot.end_time]
    );

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
    const emailDetails = await query(
      `SELECT u.email, d.full_name AS doctor_name, s.slot_date::text AS appointment_date,
              s.start_time
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN users u ON u.id = p.user_id
         JOIN doctors d ON d.id = a.doctor_id
         JOIN appointment_slots s ON s.id = a.slot_id
        WHERE a.id = $1`,
      [apptId]
    );
    const details = emailDetails.rows[0];
    const notify = require('../services/notifyService');
    await notify.sendEmailSafe({
      to: details?.email,
      title: 'Appointment confirmed',
      lines: [
        `Doctor: ${details?.doctor_name}`,
        `Date: ${details?.appointment_date}`,
        `Time: ${String(details?.start_time || '').slice(0, 5)}`,
        'Your appointment has been booked.',
      ],
    });
    const io = getIO();
    if (io) io.to(`board:${slot.doctor_id}:${slotDateStr}`).emit('board:update', {
      doctorId: slot.doctor_id,
      date: slotDateStr,
    });
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
            s.slot_date::text AS slot_date, s.start_time, s.end_time,
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
    // Free up the slot for someone else. The appointment still references this
    // slot, so keep the row and mark it available instead of deleting it.
    await client.query(
      `UPDATE appointment_slots
          SET status = 'available',
              reserved_by_patient_id = NULL,
              reservation_expires_at = NULL
        WHERE id = $1`,
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
    const emailDetails = await query(
      `SELECT u.email, d.full_name AS doctor_name, s.slot_date::text AS appointment_date,
              s.start_time
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN users u ON u.id = p.user_id
         JOIN doctors d ON d.id = a.doctor_id
         JOIN appointment_slots s ON s.id = a.slot_id
        WHERE a.id = $1`,
      [id]
    );
    const details = emailDetails.rows[0];
    const notify = require('../services/notifyService');
    await notify.sendEmailSafe({
      to: details?.email,
      title: 'Appointment cancelled',
      lines: [
        `Doctor: ${details?.doctor_name}`,
        `Date: ${details?.appointment_date}`,
        `Time: ${String(details?.start_time || '').slice(0, 5)}`,
        `Your appointment has been cancelled.${refundNote}`,
      ],
    });
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
    `SELECT a.id, a.status, a.payment_status, a.payment_method, a.fee_charged
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

  // Test-mode payment record. The schema's payments table has:
  //   - amount (NUMERIC), method (enum), status (payment_status enum)
  //   - paid_at (TIMESTAMP), created_at (TIMESTAMP DEFAULT NOW())
  //   - patient_id (NOT NULL)
  //   - UNIQUE (appointment_id) — so we UPSERT
  //   - CHECK: when method='online', card_last_four + card_brand must be set
  // Real card capture would happen against a real PSP; we just stuff
  // 'TEST' / '0000' here so the CHECK passes and the audit row is well-formed.
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO payments
         (appointment_id, patient_id, amount, method, status,
          card_brand, card_last_four, transaction_reference, paid_at)
       VALUES ($1, $2, $3, 'online', 'online_paid',
               'TEST', '0000', $4, NOW())
       ON CONFLICT (appointment_id) DO UPDATE
         SET status                = 'online_paid',
             method                = 'online',
             amount                = EXCLUDED.amount,
             card_brand            = EXCLUDED.card_brand,
             card_last_four        = EXCLUDED.card_last_four,
             transaction_reference = EXCLUDED.transaction_reference,
             paid_at               = NOW()`,
      [id, req.user.profileId, a.fee_charged, `TEST-${Date.now()}`]
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
            p.full_name       AS patient_name,
            u.id              AS patient_user_id,
            u.email           AS patient_email,
            s.slot_date,
            s.start_time,
            qe.id             AS queue_entry_id,
            qe.kanban_status,
            qe.arrival_tag,
            qe.position,
            qe.scheduled_start_time,
            qe.scheduled_end_time,
            qe.actual_start_time,
            qe.actual_end_time,
            qe.arrived_at,
            qe.admitted_at,
            qe.consultation_end_at
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN users u ON u.id = p.user_id
       JOIN appointment_slots s ON s.id = a.slot_id
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN queue_entries qe ON qe.appointment_id = a.id
      WHERE a.patient_id = $1
        AND s.slot_date = $2
        AND a.status NOT IN ('cancelled', 'no_show')
      ORDER BY s.start_time ASC`,
    [req.user.profileId, today]
  );

  if (apptRes.rowCount === 0) {
    return res.json({ active: null, appointments: [] });
  }

  const doctorIds = [...new Set(apptRes.rows.map((row) => row.doctor_id).filter(Boolean))];
  const projection = await getTimelineDisplayTimes(doctorIds, today);
  await notifyOwnLateAppointments(apptRes.rows, today);

  const appointments = [];
  for (const me of apptRes.rows) {
    const projectedCard = projection.byEntryId.get(String(me.queue_entry_id));
    const aheadCount = computeProjectedAheadCount(projection.byDoctor.get(me.doctor_id) || [], projectedCard, me);

    let stage = 'pending';
    const scheduledMin = timeToMinutes(me.scheduled_start_time || me.start_time);
    const isUnarrivedLate = me.kanban_status === 'upcoming' && timeToMinutes(currentTimeStr()) - scheduledMin > 10;
    if (isUnarrivedLate) {
      stage = 'too_late';
    } else if (me.kanban_status === 'waiting' && me.arrival_tag === 'late' && me.position == null) {
      stage = 'too_late';
    } else if (me.kanban_status === 'waiting' && me.position == null) {
      stage = 'checked_in';
    } else if (me.kanban_status === 'waiting') {
      stage = 'waiting';
    } else if (me.kanban_status === 'in_consultation') {
      stage = 'in_consultation';
    } else if (me.kanban_status === 'completed') {
      stage = 'completed';
    } else if (me.kanban_status === 'rejected') {
      stage = 'rejected';
    }

    appointments.push({
      ...me,
      stage,
      ahead_count: aheadCount,
      estimated_start_time: computePatientEstimatedStart(me, projectedCard?.displayStartTime),
    });
  }

  res.json({ active: appointments[0] || null, appointments });
});

function computePatientEstimatedStart(entry, displayedStart) {
  if (entry.kanban_status === 'completed') {
    return entry.actual_start_time || entry.scheduled_start_time || entry.start_time;
  }
  if (entry.kanban_status === 'in_consultation') {
    return entry.actual_start_time || entry.scheduled_start_time || entry.start_time;
  }
  if (displayedStart) return displayedStart;
  const now = currentTimeStr();
  const planned = entry.scheduled_start_time || entry.start_time;
  if (!planned) return now;
  return timeToMinutes(planned) < timeToMinutes(now) ? now : planned;
}

async function notifyOwnLateAppointments(appointments, dateStr) {
  const nowMin = timeToMinutes(currentTimeStr());
  const notify = require('../services/notifyService');
  for (const appointment of appointments) {
    if (appointment.kanban_status !== 'upcoming') continue;
    const scheduled = appointment.scheduled_start_time || appointment.start_time;
    if (nowMin - timeToMinutes(scheduled) <= 10) continue;
    const existing = await query(
      `SELECT 1
         FROM notifications
        WHERE appointment_id = $1
          AND type = 'too_late'
        LIMIT 1`,
      [appointment.appointment_id]
    );
    if (existing.rowCount > 0) continue;
    const message = 'You are too late for your appointment. Your live queue tracker is paused. Please contact staff to see whether you can be fit into another position today.';
    await notify.writeNotification({
      userId: appointment.patient_user_id,
      appointmentId: appointment.appointment_id,
      type: 'too_late',
      title: 'You are too late for your appointment',
      message,
    });
    await notify.sendEmailSafe({
      to: appointment.patient_email,
      title: 'You are too late for your appointment',
      lines: [
        `Doctor: ${appointment.doctor_name}`,
        `Date: ${dateStr}`,
        `Time: ${String(scheduled || '').slice(0, 5)}`,
        message,
      ],
    });
  }
}

async function getTimelineDisplayTimes(doctorIds, dateStr) {
  const byEntryId = new Map();
  const byDoctor = new Map();
  if (!doctorIds.length) return { byEntryId, byDoctor };

  const result = await query(
    `SELECT qe.id,
            qe.doctor_id,
            qe.kanban_status,
            qe.arrival_tag,
            qe.position,
            qe.scheduled_start_time,
            qe.scheduled_end_time,
            qe.actual_start_time,
            qe.actual_end_time,
            qe.arrived_at,
            qe.created_at,
            s.start_time AS original_scheduled_start,
            a.status AS appointment_status
       FROM queue_entries qe
       JOIN appointments a ON a.id = qe.appointment_id
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE qe.doctor_id = ANY($1::uuid[])
        AND qe.queue_date = $2
        AND qe.kanban_status NOT IN ('rejected', 'no_show')
        AND a.status NOT IN ('cancelled', 'no_show')
      ORDER BY qe.doctor_id, qe.scheduled_start_time, qe.created_at`,
    [doctorIds, dateStr]
  );

  const nowMin = timeToMinutes(currentTimeStr());
  for (const doctorId of doctorIds) {
    const entries = result.rows.filter((row) => row.doctor_id === doctorId);
    const cards = layoutTimelineCards(entries, nowMin).map((card, index) => ({
      ...card,
      index,
      displayStartTime: minutesToTime(card.displayStart),
    }));
    byDoctor.set(doctorId, cards);
    for (const card of cards) {
      byEntryId.set(String(card.entry.id), card);
    }
  }
  return { byEntryId, byDoctor };
}

function computeProjectedAheadCount(cards, currentCard, entry) {
  if (!currentCard || ['completed', 'rejected'].includes(entry.kanban_status)) return 0;
  if (entry.kanban_status === 'waiting' && entry.arrival_tag === 'late' && entry.position == null) return 0;
  if (entry.kanban_status === 'in_consultation') return 0;
  return cards.filter((card) => {
    if (card.entry.id === entry.queue_entry_id) return false;
    if (!['upcoming', 'waiting', 'in_consultation'].includes(card.entry.kanban_status)) return false;
    if (card.entry.kanban_status === 'waiting' && card.entry.arrival_tag === 'late' && card.entry.position == null) return false;
    return card.index < currentCard.index;
  }).length;
}

function layoutTimelineCards(entries, nowMin) {
  const PX_PER_MIN = 1.25;
  const CARD_GAP = 0;
  const MIN_CARD_H = 18;
  const LATE_CARD_H = 34;
  const gapMin = CARD_GAP / PX_PER_MIN;
  const minCardMin = MIN_CARD_H / PX_PER_MIN;
  const lateCardMin = LATE_CARD_H / PX_PER_MIN;
  let queueCursorEnd = -Infinity;
  let visualCursorNextStart = -Infinity;
  return entries
    .filter((entry) => {
      const onLive = entry.position != null;
      if (entry.kanban_status === 'waiting' && entry.arrival_tag === 'late' && !onLive) {
        return false;
      }
      if (entry.kanban_status === 'upcoming') {
        const sched = timeToMinutes(entry.scheduled_start_time);
        if (nowMin - sched > 10) return false;
      }
      return true;
    })
    .map((entry) => {
      const visibleStart = computeTimelineVisibleStart(entry, nowMin);
      const visibleEnd = computeTimelineVisibleEnd(entry, nowMin, visibleStart);
      return { entry, visibleStart, visibleEnd };
    })
    .sort((a, b) => {
      if (a.visibleStart !== b.visibleStart) return a.visibleStart - b.visibleStart;
      const posDiff = Number(a.entry.position ?? 9999) - Number(b.entry.position ?? 9999);
      if (posDiff !== 0) return posDiff;
      const startDiff = timeToMinutes(a.entry.scheduled_start_time) - timeToMinutes(b.entry.scheduled_start_time);
      if (startDiff !== 0) return startDiff;
      return String(a.entry.id).localeCompare(String(b.entry.id));
    })
    .map((card) => {
      const duration = Math.max(1, card.visibleEnd - card.visibleStart);
      const displayStart = Math.round(Math.max(card.visibleStart, queueCursorEnd, visualCursorNextStart));
      const displayEnd = displayStart + duration;
      const late = card.entry.arrival_tag === 'late' && card.entry.arrived_at;
      const visualDuration = late
        ? Math.max(lateCardMin + gapMin, duration)
        : Math.max(minCardMin + gapMin, duration);
      queueCursorEnd = displayEnd;
      visualCursorNextStart = displayStart + visualDuration;
      return { ...card, displayStart, displayEnd };
    });
}

function computeTimelineVisibleStart(entry, nowMin) {
  if (entry.kanban_status === 'completed') {
    return timeToMinutes(entry.actual_start_time || entry.scheduled_start_time);
  }
  if (entry.kanban_status === 'in_consultation') {
    const actual = timeToMinutes(entry.actual_start_time || entry.scheduled_start_time);
    return Math.min(actual, nowMin);
  }
  const sched = timeToMinutes(entry.scheduled_start_time);
  return Math.max(sched, nowMin);
}

function computeTimelineVisibleEnd(entry, nowMin, visibleStart) {
  if (entry.kanban_status === 'completed') {
    return timeToMinutes(entry.actual_end_time || entry.scheduled_end_time);
  }
  if (entry.kanban_status === 'in_consultation') {
    return Math.max(visibleStart + 5, nowMin);
  }
  const duration = timeToMinutes(entry.scheduled_end_time) - timeToMinutes(entry.scheduled_start_time);
  return visibleStart + duration;
}

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
  return res.status(403).json({ message: 'Only staff can check patients in.' });
});

const listNotifications = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT id, type, title, message, status, sent_at
       FROM notifications
      WHERE user_id = $1
        AND type IN ('booking_confirmed', 'cancelled')
      ORDER BY COALESCE(sent_at, scheduled_at) DESC
      LIMIT 50`,
    [req.user.id]
  );
  res.json({ notifications: result.rows });
});

/* ========================================================================== */
/*  Patient <-> staff communication                                            */
/* ========================================================================== */

const listTodayContactOptions = asyncHandler(async (req, res) => {
  const today = todayDateStr();
  const result = await query(
    `SELECT a.id AS appointment_id,
            d.full_name AS doctor_name,
            s.slot_date::text AS appointment_date,
            s.start_time,
            st.id AS staff_id,
            st.full_name AS staff_name,
            st.role AS staff_role
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN LATERAL (
         SELECT st.id, st.full_name, st.role
           FROM staff_doctor_assignments sda
           JOIN staff st ON st.id = sda.staff_id
          WHERE sda.doctor_id = d.id
            AND st.is_active = TRUE
          ORDER BY st.full_name ASC
          LIMIT 1
       ) st ON TRUE
      WHERE a.patient_id = $1
        AND s.slot_date = $2
        AND a.status NOT IN ('cancelled', 'completed', 'no_show')
      ORDER BY s.start_time ASC, st.full_name ASC`,
    [req.user.profileId, today]
  );
  res.json({ appointments: result.rows });
});

const getStaffConversation = asyncHandler(async (req, res) => {
  const { appointmentId } = req.query;
  const conversation = await getOrCreatePatientConversation(req.user.profileId, appointmentId);
  await markConversationReadForPatient(conversation.id, req.user.id);
  const messages = await listConversationMessages(conversation.id);
  res.json({ conversation, messages });
});

const sendStaffMessage = asyncHandler(async (req, res) => {
  const { message } = req.body || {};
  const { appointmentId } = req.body || {};
  const trimmed = (message || '').trim();
  if (!trimmed) return res.status(400).json({ message: 'Message cannot be empty.' });
  if (trimmed.length > 2000) {
    return res.status(400).json({ message: 'Message must be 2000 characters or fewer.' });
  }

  const conversation = await getOrCreatePatientConversation(req.user.profileId, appointmentId);
  const result = await query(
    `INSERT INTO patient_staff_messages
       (conversation_id, sender_user_id, message, read_by_patient_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, conversation_id, sender_user_id, message, sent_at`,
    [conversation.id, req.user.id, trimmed]
  );
  await query(
    `UPDATE patient_staff_conversations
        SET status = 'open', last_message_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [conversation.id]
  );

  const row = {
    ...result.rows[0],
    sender_role: req.user.role,
    sender_name: req.user.fullName,
  };
  emitPatientStaffMessage(conversation, row);
  res.status(201).json({ message: row });
});

async function getOrCreatePatientConversation(patientId, appointmentId) {
  const today = todayDateStr();
  if (!appointmentId) throw httpError(400, 'Choose a same-day appointment before messaging staff.');

  const eligible = await query(
    `SELECT a.id, d.full_name AS doctor_name,
            st.id AS staff_id, st.full_name AS staff_name
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN staff_doctor_assignments sda ON sda.doctor_id = d.id
       LEFT JOIN staff st ON st.id = sda.staff_id AND st.is_active = TRUE
      WHERE a.id = $1
        AND a.patient_id = $2
        AND s.slot_date = $3
        AND a.status NOT IN ('cancelled', 'completed', 'no_show')
      ORDER BY st.full_name ASC
      LIMIT 1`,
    [appointmentId, patientId, today]
  );
  if (eligible.rowCount === 0) {
    throw httpError(403, 'You can contact staff only on the same day as an active appointment.');
  }

  const existing = await query(
    `SELECT c.id, c.patient_id, c.appointment_id, c.assigned_staff_id,
            c.subject, c.status, c.last_message_at, c.created_at,
            p.full_name AS patient_name, st.full_name AS staff_name
       FROM patient_staff_conversations c
       JOIN patients p ON p.id = c.patient_id
       LEFT JOIN staff st ON st.id = c.assigned_staff_id
      WHERE c.patient_id = $1
        AND c.appointment_id = $2
        AND c.status <> 'resolved'
      ORDER BY c.last_message_at DESC
      LIMIT 1`,
    [patientId, appointmentId]
  );
  if (existing.rowCount > 0) return existing.rows[0];

  const created = await query(
    `INSERT INTO patient_staff_conversations
       (patient_id, appointment_id, assigned_staff_id, subject)
     VALUES ($1, $2, $3, $4)
     RETURNING id, patient_id, appointment_id, assigned_staff_id,
               subject, status, last_message_at, created_at`,
    [
      patientId,
      appointmentId,
      eligible.rows[0].staff_id || null,
      `Question about ${eligible.rows[0].doctor_name}`,
    ]
  );
  const patient = await query('SELECT full_name AS patient_name FROM patients WHERE id = $1', [patientId]);
  return {
    ...created.rows[0],
    patient_name: patient.rows[0]?.patient_name,
    staff_name: eligible.rows[0].staff_name,
  };
}

async function markConversationReadForPatient(conversationId, userId) {
  await query(
    `UPDATE patient_staff_messages
        SET read_by_patient_at = NOW()
      WHERE conversation_id = $1
        AND sender_user_id <> $2
        AND read_by_patient_at IS NULL`,
    [conversationId, userId]
  );
}

async function listConversationMessages(conversationId) {
  const result = await query(
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
    [conversationId]
  );
  return result.rows;
}

function emitPatientStaffMessage(conversation, messageRow) {
  const io = getIO();
  if (!io) return;
  const payload = { conversationId: conversation.id, conversation, message: messageRow };
  io.to(`patient_staff:${conversation.id}`).emit('patient_staff:new', payload);
  io.to(`patient:communication:${conversation.patient_id}`).emit('patient_staff:new', payload);
  io.to('staff:communication').emit('patient_staff:new', payload);
}

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
  // Patient <-> staff communication
  listTodayContactOptions, getStaffConversation, sendStaffMessage,
};
