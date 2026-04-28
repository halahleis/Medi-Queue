/**
 * Queue Service
 * ----------------------------------------------------------------------------
 * Business logic for the staff Live Schedule + Kanban board.
 * Implements:
 *  - Morning sync (auto-create queue_entries for the day)
 *  - Check-in flow (manual + with arrival tag)
 *  - Add to live schedule, Admit, Reject, Action Required, Complete
 *  - Time updates with the "push-down" collision shifter
 *  - Locking rules:
 *      in_consultation -> start time locked
 *      completed       -> both times locked
 *  - Visible-start enforcement (max(actual, current_time) for non-active cards)
 *  - Lateness tagging
 */

const { query, getClient } = require('../config/db');
const {
  timeToMinutes,
  minutesToTime,
  getDayOfWeek,
  todayDateStr,
  currentTimeStr,
} = require('../utils/time');

// Tunable thresholds
const EARLY_TOO_EARLY_MIN = 120;   // > 2h early -> "too early"
const LATE_GRACE_MIN = 10;          // beyond this they get the late label

/**
 * Make sure queue_entries exist for every confirmed/pending appointment
 * for the given doctor + date. Idempotent.
 */
const morningSync = async (doctorId, dateStr) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Pull all appointments for that doctor + date that aren't cancelled.
    const apptResult = await client.query(
      `SELECT a.id, a.scheduled_at, s.start_time, s.end_time
         FROM appointments a
         JOIN appointment_slots s ON s.id = a.slot_id
        WHERE a.doctor_id = $1
          AND s.slot_date = $2
          AND a.status NOT IN ('cancelled')`,
      [doctorId, dateStr]
    );

    for (const a of apptResult.rows) {
      // Insert only if no queue entry already exists for this appointment.
      await client.query(
        `INSERT INTO queue_entries
           (appointment_id, queue_date, doctor_id, scheduled_start_time, scheduled_end_time, kanban_status)
         VALUES ($1, $2, $3, $4, $5, 'upcoming')
         ON CONFLICT (appointment_id) DO NOTHING`,
        [a.id, dateStr, doctorId, a.start_time, a.end_time]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Compute arrival_tag based on the difference between now and scheduled time.
 */
const computeArrivalTag = (scheduledStart, nowStr) => {
  const diffMin = timeToMinutes(nowStr) - timeToMinutes(scheduledStart);
  if (diffMin < -5) return 'early';
  if (diffMin > LATE_GRACE_MIN) return 'late';
  return 'on_time';
};

/**
 * Fetch the full kanban + live schedule view for a doctor and date.
 * Returns { entries, doctor, blockedIntervals }.
 */
const getBoard = async (doctorId, dateStr) => {
  await morningSync(doctorId, dateStr);

  const entriesResult = await query(
    `SELECT
        qe.id,
        qe.appointment_id,
        qe.kanban_status,
        qe.arrival_tag,
        qe.arrived_at,
        qe.admitted_at,
        qe.consultation_end_at,
        qe.scheduled_start_time,
        qe.scheduled_end_time,
        qe.actual_start_time,
        qe.actual_end_time,
        qe.position,
        qe.staff_notes,
        qe.rejection_reason,
        a.visit_type,
        a.status            AS appointment_status,
        a.payment_status,
        a.fee_charged,
        p.id                AS patient_id,
        p.full_name         AS patient_name,
        u.email             AS patient_email,
        u.phone             AS patient_phone,
        -- Original booked slot time. Immutable — survives delay shifts.
        -- Used for the "X min late" label so it remains stable when a
        -- delay is applied to the queue.
        s.start_time        AS original_scheduled_start,
        s.end_time          AS original_scheduled_end
       FROM queue_entries qe
       JOIN appointments        a ON a.id = qe.appointment_id
       JOIN appointment_slots   s ON s.id = a.slot_id
       JOIN patients            p ON p.id = a.patient_id
       JOIN users               u ON u.id = p.user_id
      WHERE qe.doctor_id = $1
        AND qe.queue_date = $2
      ORDER BY qe.scheduled_start_time ASC`,
    [doctorId, dateStr]
  );

  const doctorResult = await query(
    `SELECT d.id, d.full_name, d.specialty, d.appointment_duration_minutes,
            dep.name AS department_name
       FROM doctors d
       LEFT JOIN departments dep ON dep.id = d.department_id
      WHERE d.id = $1`,
    [doctorId]
  );

  // Doctor's working windows for the day (recurring weekly schedule).
  const dayName = getDayOfWeek(dateStr);
  const scheduleResult = await query(
    `SELECT start_time, end_time FROM doctor_schedules
      WHERE doctor_id = $1 AND day_of_week = $2 AND is_active = TRUE
      ORDER BY start_time`,
    [doctorId, dayName]
  );

  // Doctor unavailability (full-day or specific blocks) for that date.
  const unavailResult = await query(
    `SELECT block_start_time, block_end_time, reason, is_full_day
       FROM doctor_unavailabilities
      WHERE doctor_id = $1 AND unavailable_date = $2`,
    [doctorId, dateStr]
  );

  return {
    doctor: doctorResult.rows[0] || null,
    entries: entriesResult.rows,
    workingHours: scheduleResult.rows,
    blockedIntervals: unavailResult.rows,
  };
};

/**
 * Manual check-in by staff (clicks "Check-in" on an upcoming card).
 * Sets arrived_at + arrival_tag and moves card to 'waiting' kanban column.
 * Note: per spec, this does NOT yet add them to the live schedule —
 * staff still has to click "Add to Live Schedule" afterwards.
 */
const manualCheckIn = async (queueEntryId, staffId) => {
  const nowStr = currentTimeStr();

  const entry = await query(
    'SELECT scheduled_start_time, kanban_status FROM queue_entries WHERE id = $1',
    [queueEntryId]
  );
  if (entry.rowCount === 0) throw httpError(404, 'Queue entry not found.');
  if (entry.rows[0].kanban_status !== 'upcoming') {
    throw httpError(400, 'Patient is no longer in the upcoming column.');
  }

  const tag = computeArrivalTag(entry.rows[0].scheduled_start_time, nowStr);

  const result = await query(
    `UPDATE queue_entries
        SET kanban_status = 'waiting',
            arrived_at = NOW(),
            arrival_tag = $2,
            staff_id = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [queueEntryId, tag, staffId]
  );
  return result.rows[0];
};

/**
 * Add a checked-in patient to the active live schedule.
 * Per spec: card stays in waiting room column but its "validated" flag flips.
 * We model this with `position` (NULL = not yet on live schedule, integer = on it).
 */
const addToLiveSchedule = async (queueEntryId, staffId) => {
  // Assign next free position for this doctor+date.
  const entry = await query(
    'SELECT doctor_id, queue_date, kanban_status FROM queue_entries WHERE id = $1',
    [queueEntryId]
  );
  if (entry.rowCount === 0) throw httpError(404, 'Queue entry not found.');
  if (entry.rows[0].kanban_status !== 'waiting') {
    throw httpError(400, 'Patient must be in the waiting room before being added to the live schedule.');
  }

  const posResult = await query(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
       FROM queue_entries
      WHERE doctor_id = $1 AND queue_date = $2 AND position IS NOT NULL`,
    [entry.rows[0].doctor_id, entry.rows[0].queue_date]
  );

  const result = await query(
    `UPDATE queue_entries
        SET position = $2, staff_id = $3, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [queueEntryId, posResult.rows[0].next_pos, staffId]
  );
  return result.rows[0];
};

/**
 * Admit a patient: move to in_consultation, lock start_time.
 * startTime is an "HH:MM:SS" string. It must be:
 *   - >= latest completed end time
 *   - <= current time
 */
const admitPatient = async (queueEntryId, staffId, startTimeStr) => {
  const nowStr = currentTimeStr();
  const start = startTimeStr || nowStr;

  const entry = await query(
    'SELECT doctor_id, queue_date, kanban_status FROM queue_entries WHERE id = $1',
    [queueEntryId]
  );
  if (entry.rowCount === 0) throw httpError(404, 'Queue entry not found.');
  if (entry.rows[0].kanban_status !== 'waiting') {
    throw httpError(400, 'Patient must be in waiting room to be admitted.');
  }

  // Only one patient at a time may be in consultation per doctor/day.
  const inConsult = await query(
    `SELECT qe.id, p.full_name AS patient_name
       FROM queue_entries qe
       JOIN appointments  a ON a.id = qe.appointment_id
       JOIN patients      p ON p.id = a.patient_id
      WHERE qe.doctor_id = $1
        AND qe.queue_date = $2
        AND qe.kanban_status = 'in_consultation'
      LIMIT 1`,
    [entry.rows[0].doctor_id, entry.rows[0].queue_date]
  );
  if (inConsult.rowCount > 0) {
    throw httpError(
      409,
      `Cannot admit: ${inConsult.rows[0].patient_name} is currently in consultation. Complete that visit first.`
    );
  }

  // Validate against latest completed end time.
  const latestCompleted = await query(
    `SELECT MAX(actual_end_time) AS max_end
       FROM queue_entries
      WHERE doctor_id = $1 AND queue_date = $2 AND kanban_status = 'completed'`,
    [entry.rows[0].doctor_id, entry.rows[0].queue_date]
  );
  const maxEnd = latestCompleted.rows[0].max_end;
  if (maxEnd && timeToMinutes(start) < timeToMinutes(maxEnd)) {
    throw httpError(400, `Start time cannot be before last completed visit (${maxEnd}).`);
  }
  if (timeToMinutes(start) > timeToMinutes(nowStr)) {
    throw httpError(400, 'Start time cannot be in the future.');
  }

  const result = await query(
    `UPDATE queue_entries
        SET kanban_status = 'in_consultation',
            admitted_at = NOW(),
            actual_start_time = $2,
            staff_id = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [queueEntryId, start, staffId]
  );
  return result.rows[0];
};

/**
 * Complete a consultation: move to completed, lock both times.
 */
const completeVisit = async (queueEntryId, staffId, endTimeStr, notes) => {
  const nowStr = currentTimeStr();
  const end = endTimeStr || nowStr;

  const entry = await query(
    'SELECT actual_start_time, kanban_status, appointment_id FROM queue_entries WHERE id = $1',
    [queueEntryId]
  );
  if (entry.rowCount === 0) throw httpError(404, 'Queue entry not found.');
  if (entry.rows[0].kanban_status !== 'in_consultation') {
    throw httpError(400, 'Only in-consultation entries can be completed.');
  }
  if (
    entry.rows[0].actual_start_time &&
    timeToMinutes(end) < timeToMinutes(entry.rows[0].actual_start_time)
  ) {
    throw httpError(400, 'End time cannot be before start time.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const updated = await client.query(
      `UPDATE queue_entries
          SET kanban_status = 'completed',
              consultation_end_at = NOW(),
              actual_end_time = $2,
              staff_notes = COALESCE($3, staff_notes),
              staff_id = $4,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [queueEntryId, end, notes || null, staffId]
    );

    // Mark the underlying appointment as completed too.
    await client.query(
      `UPDATE appointments SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [entry.rows[0].appointment_id]
    );

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Reject a patient.
 */
const rejectPatient = async (queueEntryId, staffId, reason) => {
  if (!reason || !reason.trim()) {
    throw httpError(400, 'A rejection reason is required.');
  }
  const entry = await query(
    'SELECT kanban_status, appointment_id FROM queue_entries WHERE id = $1',
    [queueEntryId]
  );
  if (entry.rowCount === 0) throw httpError(404, 'Queue entry not found.');
  if (['completed', 'rejected'].includes(entry.rows[0].kanban_status)) {
    throw httpError(400, 'Cannot reject a completed or already rejected entry.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE queue_entries
          SET kanban_status = 'rejected',
              rejection_reason = $2,
              position = NULL,
              staff_id = $3,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [queueEntryId, reason.trim(), staffId]
    );
    await client.query(
      `UPDATE appointments SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [entry.rows[0].appointment_id]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Mark patient as no_show.
 */
const markNoShow = async (queueEntryId, staffId) => {
  const entry = await query(
    'SELECT kanban_status, appointment_id FROM queue_entries WHERE id = $1',
    [queueEntryId]
  );
  if (entry.rowCount === 0) throw httpError(404, 'Queue entry not found.');
  if (entry.rows[0].kanban_status !== 'upcoming') {
    throw httpError(400, 'Only upcoming patients who never arrived can be marked no-show.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE queue_entries
          SET kanban_status = 'no_show', position = NULL, staff_id = $2, updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [queueEntryId, staffId]
    );
    await client.query(
      `UPDATE appointments SET status = 'no_show', updated_at = NOW() WHERE id = $1`,
      [entry.rows[0].appointment_id]
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * "Push-down" collision shifter.
 *
 * Update one queue_entry's scheduled_start_time and scheduled_end_time.
 * Then walk through all later, still-pending entries (upcoming/waiting) in
 * scheduled-start order: if any one starts before the previous one ends,
 * shift it (and its end) forward by exactly the overlap minutes.
 *
 * Locking rules:
 *  - in_consultation/completed entries: untouched.
 *  - The edited entry itself must respect locks if it is in_consultation
 *    (start time locked, end editable) or completed (both locked, throws).
 */
const updateEntryTimes = async (queueEntryId, staffId, newStart, newEnd) => {
  const startMin = timeToMinutes(newStart);
  const endMin = timeToMinutes(newEnd);
  if (startMin == null || endMin == null) throw httpError(400, 'Invalid time format.');
  if (endMin <= startMin) throw httpError(400, 'End time must be after start time.');

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const entryRes = await client.query(
      `SELECT id, doctor_id, queue_date, kanban_status,
              scheduled_start_time, scheduled_end_time,
              actual_start_time, actual_end_time
         FROM queue_entries WHERE id = $1`,
      [queueEntryId]
    );
    if (entryRes.rowCount === 0) throw httpError(404, 'Queue entry not found.');
    const target = entryRes.rows[0];

    if (target.kanban_status === 'completed') {
      throw httpError(400, 'Completed visits are locked.');
    }

    // For in_consultation: start is locked to actual_start_time. Only end editable.
    let appliedStart = newStart;
    let appliedEnd = newEnd;
    if (target.kanban_status === 'in_consultation') {
      appliedStart = target.actual_start_time || target.scheduled_start_time;
      if (timeToMinutes(appliedEnd) <= timeToMinutes(appliedStart)) {
        throw httpError(400, 'End time must be after the (locked) start time.');
      }
    }

    // Check the doctor's blocked intervals and prevent placing a card inside one.
    const blocked = await client.query(
      `SELECT block_start_time, block_end_time, is_full_day
         FROM doctor_unavailabilities
        WHERE doctor_id = $1 AND unavailable_date = $2`,
      [target.doctor_id, target.queue_date]
    );
    for (const b of blocked.rows) {
      if (b.is_full_day) {
        throw httpError(400, 'Doctor is unavailable for the entire day.');
      }
      const bs = timeToMinutes(b.block_start_time);
      const be = timeToMinutes(b.block_end_time);
      const aS = timeToMinutes(appliedStart);
      const aE = timeToMinutes(appliedEnd);
      // Overlap test
      if (aS < be && aE > bs) {
        throw httpError(
          400,
          `Time conflicts with a doctor-unavailable block (${b.block_start_time}–${b.block_end_time}).`
        );
      }
    }

    await client.query(
      `UPDATE queue_entries
          SET scheduled_start_time = $2,
              scheduled_end_time = $3,
              staff_id = $4,
              updated_at = NOW()
        WHERE id = $1`,
      [queueEntryId, appliedStart, appliedEnd, staffId]
    );

    // Push-down: walk all later editable entries in order.
    const laterRes = await client.query(
      `SELECT id, scheduled_start_time, scheduled_end_time, kanban_status
         FROM queue_entries
        WHERE doctor_id = $1
          AND queue_date = $2
          AND id <> $3
          AND kanban_status IN ('upcoming', 'waiting')
          AND scheduled_start_time >= $4
        ORDER BY scheduled_start_time ASC, created_at ASC`,
      [target.doctor_id, target.queue_date, queueEntryId, target.scheduled_start_time]
    );

    let prevEnd = appliedEnd;
    for (const row of laterRes.rows) {
      const curStart = timeToMinutes(row.scheduled_start_time);
      const curEnd = timeToMinutes(row.scheduled_end_time);
      const duration = curEnd - curStart;
      const prevEndMin = timeToMinutes(prevEnd);
      if (curStart < prevEndMin) {
        const newS = prevEndMin;
        const newE = newS + duration;
        await client.query(
          `UPDATE queue_entries
              SET scheduled_start_time = $2,
                  scheduled_end_time = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [row.id, minutesToTime(newS), minutesToTime(newE)]
        );
        prevEnd = minutesToTime(newE);
      } else {
        prevEnd = row.scheduled_end_time;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Apply a global delay (e.g. doctor reports running 15 min late).
 *
 * Semantically this means "the queue cannot resume until NOW + delayMinutes".
 * For each affected entry the new scheduled_start_time becomes:
 *   max(scheduled_start_time, current_time) + delayMinutes
 *
 * Effect:
 *  - A future appointment shifts forward by `delayMinutes`.
 *  - An entry whose scheduled time has already passed (i.e. was pinned to
 *    the NOW delimiter on the timeline) is repositioned to `NOW + delay`,
 *    so it visually moves down on the timeline by `delay` minutes rather
 *    than staying glued to NOW.
 *
 * Excluded from the shift (per spec — these are off the active queue):
 *  - Late upcoming patients (haven't arrived; scheduled time + grace passed).
 *    Their scheduled_start_time stays as the original so staff can see how
 *    late they are if/when they arrive.
 *  - Waiting patients not yet on the live queue (position IS NULL),
 *    typically late arrivals awaiting staff triage.
 *
 * The duration of every affected entry is preserved.
 */
const applyGlobalDelay = async (doctorId, dateStr, delayMinutes, staffId) => {
  if (!Number.isFinite(delayMinutes) || delayMinutes === 0) {
    throw httpError(400, 'Invalid delay value.');
  }
  await query(
    `UPDATE queue_entries
        SET scheduled_start_time =
              (GREATEST(scheduled_start_time, CURRENT_TIME::time)
               + ($3 || ' minutes')::interval)::time,
            scheduled_end_time =
              (GREATEST(scheduled_start_time, CURRENT_TIME::time)
               + ($3 || ' minutes')::interval
               + (scheduled_end_time - scheduled_start_time))::time,
            staff_id = $4,
            updated_at = NOW()
      WHERE doctor_id = $1
        AND queue_date = $2
        AND (
          -- Future / on-time upcoming: scheduled time hasn't passed grace.
          (kanban_status = 'upcoming'
            AND scheduled_start_time + ($5 || ' minutes')::interval > CURRENT_TIME::time)
          OR
          -- Waiting AND already on the live queue.
          (kanban_status = 'waiting' AND position IS NOT NULL)
        )`,
    [doctorId, dateStr, delayMinutes, staffId, LATE_GRACE_MIN]
  );
};

/**
 * Helper to throw structured HTTP errors.
 */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = {
  morningSync,
  getBoard,
  manualCheckIn,
  addToLiveSchedule,
  admitPatient,
  completeVisit,
  rejectPatient,
  markNoShow,
  updateEntryTimes,
  applyGlobalDelay,
  computeArrivalTag,
  todayDateStr,
};