/**
 * Admin Controller
 * ----------------------------------------------------------------------------
 * Hospital Administrator perspective. Manages departments, doctors, staff
 * accounts, and produces operational reports.
 *
 * Design choices:
 *  - Removal is "soft": entities with foreign-key history (doctors, staff,
 *    departments) are deactivated rather than deleted, preserving audit
 *    trails and referential integrity. Re-activation is supported.
 *  - User accounts (users row) are created/updated atomically with their
 *    role-specific profile row inside a transaction.
 *  - Listing endpoints return BOTH active and inactive rows so the admin can
 *    re-activate things; the kanban-style consumer-facing endpoints already
 *    filter to active=TRUE so this doesn't leak.
 */

const bcrypt = require('bcryptjs');
const { query, getClient } = require('../config/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { logAction } = require('../utils/audit');
const { todayDateStr } = require('../utils/time');
const { validatePassword } = require('../utils/validation');

/* -------------------------------------------------------------------------- */
/*  Dashboard overview                                                         */
/* -------------------------------------------------------------------------- */
const overview = asyncHandler(async (req, res) => {
  const today = todayDateStr();

  const result = await query(
    `SELECT
      (SELECT COUNT(*) FROM doctors      WHERE is_active = TRUE)            AS active_doctors,
      (SELECT COUNT(*) FROM doctors      WHERE is_active = FALSE)           AS inactive_doctors,
      (SELECT COUNT(*) FROM patients)                                       AS total_patients,
      (SELECT COUNT(*) FROM departments  WHERE is_active = TRUE)            AS active_departments,
      (SELECT COUNT(*) FROM staff        WHERE is_active = TRUE)            AS active_staff,
      (SELECT COUNT(*) FROM appointments
        JOIN appointment_slots s ON s.id = appointments.slot_id
        WHERE s.slot_date = $1)                                             AS appointments_today,
      (SELECT COUNT(*) FROM appointments
        JOIN appointment_slots s ON s.id = appointments.slot_id
        WHERE s.slot_date = $1 AND appointments.status = 'cancelled')       AS cancellations_today,
      (SELECT COUNT(*) FROM appointments
        JOIN appointment_slots s ON s.id = appointments.slot_id
        WHERE s.slot_date = $1 AND appointments.status = 'completed')       AS completed_today`,
    [today]
  );

  res.json({ today, stats: result.rows[0] });
});

/* -------------------------------------------------------------------------- */
/*  Departments                                                                */
/* -------------------------------------------------------------------------- */
const listDepartments = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT d.id, d.name, d.description, d.is_active, d.created_at,
            COUNT(doc.id) FILTER (WHERE doc.is_active = TRUE) AS doctor_count
       FROM departments d
       LEFT JOIN doctors doc ON doc.department_id = d.id
      GROUP BY d.id
      ORDER BY d.is_active DESC, d.name ASC`
  );
  res.json({ departments: result.rows });
});

const createDepartment = asyncHandler(async (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Department name is required.' });
  }

  const existing = await query('SELECT id FROM departments WHERE LOWER(name) = LOWER($1)', [name.trim()]);
  if (existing.rowCount > 0) {
    return res.status(409).json({ message: 'A department with that name already exists.' });
  }

  const result = await query(
    `INSERT INTO departments (name, description) VALUES ($1, $2)
     RETURNING id, name, description, is_active, created_at`,
    [name.trim(), description || null]
  );
  await logAction({ action: 'admin_create_department', metadata: { id: result.rows[0].id, name: result.rows[0].name } });
  res.status(201).json({ department: result.rows[0] });
});

const updateDepartment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Department name is required.' });
  }
  const dup = await query(
    'SELECT id FROM departments WHERE LOWER(name) = LOWER($1) AND id <> $2',
    [name.trim(), id]
  );
  if (dup.rowCount > 0) {
    return res.status(409).json({ message: 'Another department already has that name.' });
  }
  const result = await query(
    `UPDATE departments SET name = $1, description = $2
      WHERE id = $3
      RETURNING id, name, description, is_active`,
    [name.trim(), description || null, id]
  );
  if (result.rowCount === 0) return res.status(404).json({ message: 'Department not found.' });
  await logAction({ action: 'admin_update_department', metadata: { id } });
  res.json({ department: result.rows[0] });
});

const setDepartmentActive = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body || {};
  const result = await query(
    `UPDATE departments SET is_active = $1 WHERE id = $2
     RETURNING id, name, is_active`,
    [!!isActive, id]
  );
  if (result.rowCount === 0) return res.status(404).json({ message: 'Department not found.' });
  await logAction({
    action: isActive ? 'admin_activate_department' : 'admin_deactivate_department',
    metadata: { id },
  });
  res.json({ department: result.rows[0] });
});

/* -------------------------------------------------------------------------- */
/*  Doctors                                                                    */
/* -------------------------------------------------------------------------- */
const listDoctors = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT d.id, d.full_name, d.specialty, d.qualifications, d.biography,
            d.standard_fee, d.followup_fee, d.appointment_duration_minutes,
            d.is_active, d.department_id,
            dep.name AS department_name,
            u.id AS user_id, u.email, u.phone, u.is_active AS user_active
       FROM doctors d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN departments dep ON dep.id = d.department_id
      ORDER BY d.is_active DESC, d.full_name ASC`
  );
  res.json({ doctors: result.rows });
});

const createDoctor = asyncHandler(async (req, res) => {
  const {
    email, password, phone,
    fullName, specialty, qualifications, biography,
    departmentId, standardFee, followupFee, appointmentDurationMinutes,
  } = req.body || {};

  if (!email || !password || !fullName || !specialty) {
    return res.status(400).json({ message: 'Email, password, full name, and specialty are required.' });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const dup = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (dup.rowCount > 0) {
    return res.status(409).json({ message: 'That email is already in use.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, phone, role)
       VALUES ($1, $2, $3, 'doctor')
       RETURNING id`,
      [email.toLowerCase().trim(), passwordHash, phone || null]
    );
    const docRes = await client.query(
      `INSERT INTO doctors
         (user_id, department_id, full_name, specialty, qualifications, biography,
          standard_fee, followup_fee, appointment_duration_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userRes.rows[0].id,
        departmentId || null,
        fullName.trim(),
        specialty.trim(),
        qualifications || null,
        biography || null,
        standardFee || 0,
        followupFee || 0,
        appointmentDurationMinutes || 20,
      ]
    );
    await client.query('COMMIT');
    await logAction({
      action: 'admin_create_doctor',
      doctorId: docRes.rows[0].id,
      metadata: { email },
    });
    res.status(201).json({ id: docRes.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const updateDoctor = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    fullName, specialty, qualifications, biography,
    departmentId, standardFee, followupFee, appointmentDurationMinutes,
    phone,
  } = req.body || {};

  const docRes = await query('SELECT user_id FROM doctors WHERE id = $1', [id]);
  if (docRes.rowCount === 0) return res.status(404).json({ message: 'Doctor not found.' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE doctors
          SET full_name = COALESCE($1, full_name),
              specialty = COALESCE($2, specialty),
              qualifications = $3,
              biography = $4,
              department_id = $5,
              standard_fee = COALESCE($6, standard_fee),
              followup_fee = COALESCE($7, followup_fee),
              appointment_duration_minutes = COALESCE($8, appointment_duration_minutes),
              updated_at = NOW()
        WHERE id = $9`,
      [
        fullName ? fullName.trim() : null,
        specialty ? specialty.trim() : null,
        qualifications || null,
        biography || null,
        departmentId || null,
        standardFee,
        followupFee,
        appointmentDurationMinutes,
        id,
      ]
    );
    if (phone !== undefined) {
      await client.query(
        `UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2`,
        [phone || null, docRes.rows[0].user_id]
      );
    }
    await client.query('COMMIT');
    await logAction({ action: 'admin_update_doctor', doctorId: id });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const setDoctorActive = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body || {};

  const docRes = await query('SELECT user_id FROM doctors WHERE id = $1', [id]);
  if (docRes.rowCount === 0) return res.status(404).json({ message: 'Doctor not found.' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE doctors SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [!!isActive, id]
    );
    // Also flip the user account so they can/cannot log in.
    await client.query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [!!isActive, docRes.rows[0].user_id]
    );
    await client.query('COMMIT');
    await logAction({
      action: isActive ? 'admin_activate_doctor' : 'admin_deactivate_doctor',
      doctorId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const resetDoctorPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  const passwordError = validatePassword(newPassword || '');
  if (passwordError) return res.status(400).json({ message: passwordError });
  const docRes = await query('SELECT user_id FROM doctors WHERE id = $1', [id]);
  if (docRes.rowCount === 0) return res.status(404).json({ message: 'Doctor not found.' });
  const hash = await bcrypt.hash(newPassword, 10);
  await query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [hash, docRes.rows[0].user_id]
  );
  await logAction({ action: 'admin_reset_doctor_password', doctorId: id });
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/*  Staff accounts                                                             */
/* -------------------------------------------------------------------------- */
const listStaff = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT s.id, s.full_name, s.role, s.is_active,
            u.id AS user_id, u.email, u.phone, u.is_active AS user_active
       FROM staff s
       JOIN users u ON u.id = s.user_id
      ORDER BY s.is_active DESC, s.full_name ASC`
  );
  res.json({ staff: result.rows });
});

const createStaff = asyncHandler(async (req, res) => {
  const { email, password, phone, fullName, role } = req.body || {};
  if (!email || !password || !fullName) {
    return res.status(400).json({ message: 'Email, password, and full name are required.' });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const dup = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  if (dup.rowCount > 0) {
    return res.status(409).json({ message: 'That email is already in use.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const userRes = await client.query(
      `INSERT INTO users (email, password_hash, phone, role)
       VALUES ($1, $2, $3, 'staff') RETURNING id`,
      [email.toLowerCase().trim(), passwordHash, phone || null]
    );
    const sRes = await client.query(
      `INSERT INTO staff (user_id, full_name, role)
       VALUES ($1, $2, $3) RETURNING id`,
      [userRes.rows[0].id, fullName.trim(), role || 'receptionist']
    );
    await client.query('COMMIT');
    await logAction({ action: 'admin_create_staff', staffId: sRes.rows[0].id, metadata: { email } });
    res.status(201).json({ id: sRes.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const updateStaff = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { fullName, role, phone } = req.body || {};
  const sRes = await query('SELECT user_id FROM staff WHERE id = $1', [id]);
  if (sRes.rowCount === 0) return res.status(404).json({ message: 'Staff member not found.' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE staff
          SET full_name = COALESCE($1, full_name),
              role = COALESCE($2, role),
              updated_at = NOW()
        WHERE id = $3`,
      [fullName ? fullName.trim() : null, role || null, id]
    );
    if (phone !== undefined) {
      await client.query(
        `UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2`,
        [phone || null, sRes.rows[0].user_id]
      );
    }
    await client.query('COMMIT');
    await logAction({ action: 'admin_update_staff', staffId: id });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const setStaffActive = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body || {};
  const sRes = await query('SELECT user_id FROM staff WHERE id = $1', [id]);
  if (sRes.rowCount === 0) return res.status(404).json({ message: 'Staff member not found.' });

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE staff SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [!!isActive, id]
    );
    await client.query(
      `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`,
      [!!isActive, sRes.rows[0].user_id]
    );
    await client.query('COMMIT');
    await logAction({
      action: isActive ? 'admin_activate_staff' : 'admin_deactivate_staff',
      staffId: id,
    });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const resetStaffPassword = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body || {};
  const passwordError = validatePassword(newPassword || '');
  if (passwordError) return res.status(400).json({ message: passwordError });
  const sRes = await query('SELECT user_id FROM staff WHERE id = $1', [id]);
  if (sRes.rowCount === 0) return res.status(404).json({ message: 'Staff member not found.' });
  const hash = await bcrypt.hash(newPassword, 10);
  await query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [hash, sRes.rows[0].user_id]
  );
  await logAction({ action: 'admin_reset_staff_password', staffId: id });
  res.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/*  Reports & statistics                                                       */
/* -------------------------------------------------------------------------- */
const reports = asyncHandler(async (req, res) => {
  // `range` = number of days back from today. Defaults to 7.
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));

  // Per-day appointment counts.
  const perDay = await query(
    `SELECT s.slot_date::text AS date,
            COUNT(*)                                                AS total,
            COUNT(*) FILTER (WHERE a.status = 'completed')          AS completed,
            COUNT(*) FILTER (WHERE a.status = 'cancelled')          AS cancelled,
            COUNT(*) FILTER (WHERE a.status = 'no_show')            AS no_show
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE s.slot_date >= CURRENT_DATE - ($1 || ' days')::interval
        AND s.slot_date <= CURRENT_DATE
      GROUP BY s.slot_date
      ORDER BY s.slot_date ASC`,
    [days]
  );

  // Workload per active doctor (across the same window).
  const perDoctor = await query(
    `SELECT d.id, d.full_name, d.specialty,
            COUNT(a.id)                                             AS total,
            COUNT(a.id) FILTER (WHERE a.status = 'completed')       AS completed,
            COUNT(a.id) FILTER (WHERE a.status = 'cancelled')       AS cancelled,
            COUNT(a.id) FILTER (WHERE a.status = 'no_show')         AS no_show
       FROM doctors d
       LEFT JOIN appointments a ON a.doctor_id = d.id
       LEFT JOIN appointment_slots s ON s.id = a.slot_id
            AND s.slot_date >= CURRENT_DATE - ($1 || ' days')::interval
            AND s.slot_date <= CURRENT_DATE
      WHERE d.is_active = TRUE
      GROUP BY d.id
      ORDER BY total DESC, d.full_name ASC`,
    [days]
  );

  // Status breakdown across the window.
  const statusBreakdown = await query(
    `SELECT a.status, COUNT(*) AS count
       FROM appointments a
       JOIN appointment_slots s ON s.id = a.slot_id
      WHERE s.slot_date >= CURRENT_DATE - ($1 || ' days')::interval
        AND s.slot_date <= CURRENT_DATE
      GROUP BY a.status
      ORDER BY count DESC`,
    [days]
  );

  res.json({
    days,
    perDay: perDay.rows,
    perDoctor: perDoctor.rows,
    statusBreakdown: statusBreakdown.rows,
  });
});

module.exports = {
  overview,
  // Departments
  listDepartments, createDepartment, updateDepartment, setDepartmentActive,
  // Doctors
  listDoctors, createDoctor, updateDoctor, setDoctorActive, resetDoctorPassword,
  // Staff
  listStaff, createStaff, updateStaff, setStaffActive, resetStaffPassword,
  // Reports
  reports,
};
