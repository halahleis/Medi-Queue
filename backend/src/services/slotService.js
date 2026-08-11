/**
 * Slot Service
 * ----------------------------------------------------------------------------
 * Generates available booking slots for a doctor on a given date by combining:
 *   - the doctor's recurring weekly schedule (doctor_schedules)
 *   - their appointment_duration_minutes
 *   - any doctor_unavailabilities blocks for that date
 *   - any already-booked or held appointment_slots rows for that date
 *
 * Also implements the 3-minute slot reservation hold during booking.
 */

const { query, getClient } = require('../config/db');
const {
  timeToMinutes,
  minutesToTime,
  getDayOfWeek,
  todayDateStr,
} = require('../utils/time');

const HOLD_MINUTES = 3;
const BOOKING_WINDOW_MONTHS = 2;

/** Throw a structured HTTP error. */
const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/**
 * Drop any expired holds from appointment_slots so previously-locked slots
 * become available again. Called as a side-effect at the start of slot
 * generation — cheap enough that we don't bother scheduling it.
 */
const releaseExpiredHolds = async (clientOrPool = null) => {
  const c = clientOrPool || { query };
  await c.query(
    `DELETE FROM appointment_slots
      WHERE status = 'reserved'
        AND reservation_expires_at IS NOT NULL
        AND reservation_expires_at < NOW()`
  );
};

/**
 * Validate that a date is within the 2-month booking window from today.
 * Throws if not.
 */
const assertWithinBookingWindow = (dateStr) => {
  const today = new Date(todayDateStr() + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(target.getTime())) throw httpError(400, 'Invalid date.');
  if (target < today) throw httpError(400, 'Cannot book in the past.');

  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() + BOOKING_WINDOW_MONTHS);
  if (target > cutoff) {
    throw httpError(400, `Bookings are only allowed up to ${BOOKING_WINDOW_MONTHS} months in advance.`);
  }
};

const assertPatientCanBookSlot = async (
  patientId,
  doctorId,
  dateStr,
  startTime,
  endTime,
  clientOrPool = null
) => {
  const c = clientOrPool || { query };

  const sameDoctor = await c.query(
    `SELECT a.id
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE a.patient_id = $1
        AND a.doctor_id = $2
        AND s.slot_date = $3::date
        AND a.status <> 'cancelled'
      LIMIT 1`,
    [patientId, doctorId, dateStr]
  );
  if (sameDoctor.rowCount > 0) {
    throw httpError(409, 'You already have an appointment with this doctor on this day. Choose another day or cancel the existing appointment first.');
  }

  const overlap = await c.query(
    `SELECT a.id
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE a.patient_id = $1
        AND s.slot_date = $2::date
        AND a.status <> 'cancelled'
        AND $3::time < s.end_time
        AND $4::time > s.start_time
      LIMIT 1`,
    [patientId, dateStr, startTime, endTime]
  );
  if (overlap.rowCount > 0) {
    throw httpError(409, 'This appointment overlaps another appointment you already booked that day. Choose a different time.');
  }
};

/**
 * Compute the bookable slots for a given doctor on a given date.
 * Returns an array of { start_time, end_time, status } where status is:
 *   'available' | 'booked' | 'held' | 'blocked'
 *
 * Slots are generated from the doctor's working windows for that weekday,
 * sliced into chunks of `appointment_duration_minutes`, and overlaid with
 * existing booking records and unavailability blocks.
 */
const getSlotsForDay = async (doctorId, dateStr) => {
  await releaseExpiredHolds();

  const docRes = await query(
    `SELECT id, appointment_duration_minutes FROM doctors
      WHERE id = $1 AND is_active = TRUE`,
    [doctorId]
  );
  if (docRes.rowCount === 0) throw httpError(404, 'Doctor not found.');
  const duration = docRes.rows[0].appointment_duration_minutes || 20;

  const dayName = getDayOfWeek(dateStr);
  const schedRes = await query(
    `SELECT start_time, end_time FROM doctor_schedules
      WHERE doctor_id = $1 AND day_of_week = $2 AND is_active = TRUE
      ORDER BY start_time`,
    [doctorId, dayName]
  );
  if (schedRes.rowCount === 0) return { slots: [], duration };

  const blocksRes = await query(
    `SELECT block_start_time, block_end_time, is_full_day
       FROM doctor_unavailabilities
      WHERE doctor_id = $1 AND unavailable_date = $2`,
    [doctorId, dateStr]
  );

  // If the whole day is blocked, no slots.
  if (blocksRes.rows.some((b) => b.is_full_day)) {
    return { slots: [], duration };
  }

  const existingRes = await query(
    `SELECT start_time, end_time, status FROM appointment_slots
      WHERE doctor_id = $1 AND slot_date = $2`,
    [doctorId, dateStr]
  );

  const intersects = (start, end, blockStart, blockEnd) =>
    start < blockEnd && end > blockStart;

  // Build the list of candidate slots from each working window.
  const slots = [];
  for (const win of schedRes.rows) {
    const winStart = timeToMinutes(win.start_time);
    const winEnd = timeToMinutes(win.end_time);
    for (let t = winStart; t + duration <= winEnd; t += duration) {
      const start = t;
      const end = t + duration;

      // Skip if blocked by an unavailability interval.
      const blocked = blocksRes.rows.some((b) =>
        intersects(start, end, timeToMinutes(b.block_start_time), timeToMinutes(b.block_end_time))
      );
      if (blocked) continue;

      // Determine status against existing bookings. Match on start_time
      // (the unique-key column) — a row at the same start is the same slot
      // even if its end_time differs from what the generator would produce.
      const existing = existingRes.rows.find((r) =>
        timeToMinutes(r.start_time) === start
      );

      let status = 'available';
      if (existing) {
        if (existing.status === 'booked') status = 'booked';
        else if (existing.status === 'reserved') status = 'reserved';
      }

      // Don't show slots that are entirely in the past for today.
      if (dateStr === todayDateStr()) {
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        if (start <= nowMin) continue;
      }

      slots.push({
        start_time: minutesToTime(start),
        end_time: minutesToTime(end),
        status,
      });
    }
  }

  return { slots, duration };
};

/**
 * Place a 3-minute hold on a slot for a patient.
 * Inserts an appointment_slots row with status 'held' and reservation_expires_at = NOW()+3m,
 * then returns the slot id so the booking flow can confirm against it.
 *
 * Idempotency note: if the same patient re-attempts the hold within the window,
 * we reuse the existing held row rather than creating a duplicate.
 */
const holdSlot = async (doctorId, dateStr, startTime, endTime, patientId) => {
  assertWithinBookingWindow(dateStr);
  await releaseExpiredHolds();

  await assertPatientCanBookSlot(patientId, doctorId, dateStr, startTime, endTime);

  // Use INSERT ... ON CONFLICT DO UPDATE so this is atomic against the
  // (doctor_id, slot_date, start_time) unique constraint. A SELECT-then-
  // INSERT-or-UPDATE pattern races under concurrent calls (FOR UPDATE
  // can't lock a row that doesn't exist yet, so two simultaneous holds
  // both see an empty SELECT and both try to INSERT, with the second
  // crashing on the unique key).
  //
  // The conflict clause refuses to overwrite a real booking, and refuses
  // to steal a fresh hold from another patient. Otherwise it resets the
  // row to a brand-new reservation for this patient.
  const result = await query(
    `INSERT INTO appointment_slots
       (doctor_id, slot_date, start_time, end_time, status,
        reserved_by_patient_id, reservation_expires_at)
     VALUES ($1, $2, $3, $4, 'reserved', $5,
             NOW() + ($6 || ' minutes')::interval)
     ON CONFLICT (doctor_id, slot_date, start_time) DO UPDATE
       SET end_time               = EXCLUDED.end_time,
           status                 = 'reserved',
           reserved_by_patient_id = EXCLUDED.reserved_by_patient_id,
           reservation_expires_at = EXCLUDED.reservation_expires_at
       WHERE appointment_slots.status = 'available'
          OR (appointment_slots.status = 'reserved' AND (
                 appointment_slots.reserved_by_patient_id = EXCLUDED.reserved_by_patient_id
              OR appointment_slots.reservation_expires_at < NOW()
             ))
     RETURNING id`,
    [doctorId, dateStr, startTime, endTime, patientId, HOLD_MINUTES]
  );

  if (result.rowCount === 0) {
    // The conflict-target row exists but the WHERE on DO UPDATE rejected
    // the overwrite — so it's either booked, or a fresh reservation by
    // someone else. Surface the right message to the caller.
    const probe = await query(
      `SELECT status, reserved_by_patient_id, reservation_expires_at
         FROM appointment_slots
        WHERE doctor_id = $1 AND slot_date = $2 AND start_time = $3`,
      [doctorId, dateStr, startTime]
    );
    if (probe.rowCount === 0) {
      // Extremely unlikely race — the conflicting row was deleted between
      // the INSERT failing the WHERE and our follow-up SELECT.
      throw httpError(409, 'Slot just became unavailable. Please try again.');
    }
    const row = probe.rows[0];
    if (row.status === 'booked') {
      throw httpError(409, 'This slot has already been booked.');
    }
    throw httpError(409, 'This slot is currently held by another patient. Try again in a moment.');
  }

  return { slotId: result.rows[0].id, holdMinutes: HOLD_MINUTES };
};

/**
 * Release a held slot (e.g. patient cancelled the booking flow).
 * Only the patient who placed the hold can release it.
 */
const releaseHold = async (slotId, patientId) => {
  await query(
    `DELETE FROM appointment_slots
      WHERE id = $1 AND status = 'reserved' AND reserved_by_patient_id = $2`,
    [slotId, patientId]
  );
};

module.exports = {
  HOLD_MINUTES,
  BOOKING_WINDOW_MONTHS,
  releaseExpiredHolds,
  assertWithinBookingWindow,
  assertPatientCanBookSlot,
  getSlotsForDay,
  holdSlot,
  releaseHold,
  httpError,
};
