const { query } = require('../config/db');

/**
 * Record a staff action in audit_logs.
 * All fields are optional except `action`.
 */
const logAction = async ({
  staffId = null,
  patientId = null,
  doctorId = null,
  appointmentId = null,
  action,
  metadata = null,
}) => {
  try {
    await query(
      `INSERT INTO audit_logs (staff_id, patient_id, doctor_id, appointment_id, action, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [staffId, patientId, doctorId, appointmentId, action, metadata]
    );
  } catch (err) {
    // Audit logging must never break the actual operation.
    console.error('[AUDIT] Failed to record action:', err.message);
  }
};

module.exports = { logAction };
