const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { signToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

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

module.exports = { login, me };
