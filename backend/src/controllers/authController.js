const bcrypt = require('bcryptjs');
const { query, getClient } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { sendPasswordResetCode } = require('../services/emailService');
const { validatePassword } = require('../utils/validation');

const RESET_CODE_TTL_MINUTES = 10;

const httpError = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Works for any role. Returns user payload + JWT.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const userResult = await query(
    'SELECT id, email, password_hash, role, is_active FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  if (userResult.rowCount === 0) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const user = userResult.rows[0];
  if (!user.is_active) {
    return res.status(403).json({ message: 'Your account is inactive. Please contact admin.' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  // Resolve role-specific profile (id + name) so the client has it immediately.
  let profileId = null;
  let fullName = null;

  if (user.role === 'staff') {
    const r = await query('SELECT id, full_name FROM staff WHERE user_id = $1', [user.id]);
    if (r.rowCount) {
      profileId = r.rows[0].id;
      fullName = r.rows[0].full_name;
    }
  } else if (user.role === 'doctor') {
    const r = await query('SELECT id, full_name FROM doctors WHERE user_id = $1', [user.id]);
    if (r.rowCount) {
      profileId = r.rows[0].id;
      fullName = r.rows[0].full_name;
    }
  } else if (user.role === 'patient') {
    const r = await query('SELECT id, full_name FROM patients WHERE user_id = $1', [user.id]);
    if (r.rowCount) {
      profileId = r.rows[0].id;
      fullName = r.rows[0].full_name;
    }
  } else if (user.role === 'admin') {
    fullName = 'Hospital Administrator';
  }

  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role,
    profileId,
    fullName,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      profileId,
      fullName,
    },
  });
});

/**
 * GET /api/auth/me
 * Returns the current user's profile.
 */
const me = asyncHandler(async (req, res) => {
  res.json({ user: req.user });
});

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Sends a real email with a short-lived reset code if the account exists.
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ message: 'Email is required.' });

  const userResult = await query(
    'SELECT id, email, is_active FROM users WHERE email = $1',
    [email]
  );

  if (userResult.rowCount === 0) {
    return res.status(404).json({ message: 'Email not found. Please create an account first.' });
  }

  const user = userResult.rows[0];
  if (!user.is_active) {
    return res.status(403).json({ message: 'Your account is inactive. Please contact admin.' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await bcrypt.hash(code, 10);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE password_reset_codes
          SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    await client.query(
      `INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
      [user.id, codeHash, RESET_CODE_TTL_MINUTES]
    );

    await sendPasswordResetCode({ to: user.email, code });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ ok: true, message: 'A password reset code was sent to your email.' });
});

/**
 * POST /api/auth/reset-password
 * Body: { email, code, password }
 */
const resetPassword = asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const code = String(req.body?.code || '').trim();
  const password = String(req.body?.password || '');

  if (!email || !code || !password) {
    return res.status(400).json({ message: 'Email, code, and new password are required.' });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const userResult = await query(
    'SELECT id FROM users WHERE email = $1 AND is_active = TRUE',
    [email]
  );
  if (userResult.rowCount === 0) {
    return res.status(404).json({ message: 'Email not found. Please create an account first.' });
  }
  const userId = userResult.rows[0].id;

  const resetResult = await query(
    `SELECT id, code_hash, expires_at
       FROM password_reset_codes
      WHERE user_id = $1
        AND used_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );
  if (resetResult.rowCount === 0) {
    throw httpError(400, 'No active reset code found. Request a new code.');
  }

  const reset = resetResult.rows[0];
  if (new Date(reset.expires_at) < new Date()) {
    await query('UPDATE password_reset_codes SET used_at = NOW() WHERE id = $1', [reset.id]);
    throw httpError(400, 'Reset code expired. Request a new code.');
  }

  const validCode = await bcrypt.compare(code, reset.code_hash);
  if (!validCode) {
    throw httpError(400, 'Invalid reset code.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await query(
    `UPDATE users
        SET password_hash = $1, updated_at = NOW()
      WHERE id = $2`,
    [passwordHash, userId]
  );
  await query('UPDATE password_reset_codes SET used_at = NOW() WHERE id = $1', [reset.id]);

  res.json({ ok: true, message: 'Password updated. You can sign in now.' });
});

module.exports = { login, me, forgotPassword, resetPassword };
