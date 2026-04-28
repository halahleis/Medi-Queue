/**
 * Notify Service
 * ----------------------------------------------------------------------------
 * Single point of contact for patient-directed notifications:
 *   - Emits a socket event to the patient's personal room so the live status
 *     tracker updates instantly.
 *   - Optionally writes a row to the `notifications` table so the bell icon
 *     and history page surface the change later.
 *
 * The staff controller calls these helpers whenever an action changes a
 * specific patient's queue state. Failures here never bubble up — a
 * notification problem must not break the underlying staff action.
 */

const { query } = require('../config/db');
const { getIO } = require('../sockets/io');

/**
 * Emit a real-time status update to a patient's personal channel.
 * Subscribers (the patient's MyAppointments page) receive `patient:status`
 * and refetch their data.
 */
const emitStatusUpdate = (patientId, payload = {}) => {
  const io = getIO();
  if (!io || !patientId) return;
  io.to(`patient:${patientId}`).emit('patient:status', payload);
};

/**
 * Write a notification row. Returns silently on failure — see top-of-file note.
 *
 * `channel` and `status` are constrained by the schema's enums:
 *   notification_channel: email | sms | push
 *   notification_status:  pending | sent | failed | retrying
 * We use 'push' for in-app and 'sent' for delivered-immediately.
 */
const writeNotification = async ({
  userId, appointmentId = null,
  type, title, message,
}) => {
  try {
    if (!userId) return;
    await query(
      `INSERT INTO notifications
         (user_id, appointment_id, type, channel, title, message, status,
          scheduled_at, sent_at)
       VALUES ($1, $2, $3, 'push', $4, $5, 'sent', NOW(), NOW())`,
      [userId, appointmentId, type, title, message]
    );
  } catch (err) {
    console.error('[notify] failed to write notification:', err.message);
  }
};

/**
 * Convenience: given a queue_entry id, fetch the user_id + patient_id
 * + appointment_id needed to dispatch a notification.
 */
const lookupRecipientFromEntry = async (queueEntryId) => {
  const r = await query(
    `SELECT qe.appointment_id, p.id AS patient_id, u.id AS user_id
       FROM queue_entries qe
       JOIN appointments  a ON a.id = qe.appointment_id
       JOIN patients      p ON p.id = a.patient_id
       JOIN users         u ON u.id = p.user_id
      WHERE qe.id = $1`,
    [queueEntryId]
  );
  return r.rows[0] || null;
};

module.exports = {
  emitStatusUpdate,
  writeNotification,
  lookupRecipientFromEntry,
};
