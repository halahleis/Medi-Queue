const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_dev_secret';

/**
 * Sign a JWT for an authenticated user.
 */
const signToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '12h' });

/**
 * Authenticate a request via Bearer token.
 * Attaches `req.user = { id, email, role, profileId, fullName }` on success.
 */
const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Missing or invalid Authorization header.' });
    }
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    // Validate user still active
    const userResult = await query(
      'SELECT id, email, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );
    if (userResult.rowCount === 0 || !userResult.rows[0].is_active) {
      return res.status(401).json({ message: 'User no longer active.' });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      profileId: decoded.profileId,
      fullName: decoded.fullName,
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

/**
 * Restrict access to one or more roles.
 *   router.get('/staff/dashboard', authenticate, requireRole('staff'), handler)
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Not authenticated.' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ message: `Requires role: ${roles.join(' or ')}.` });
  }
  next();
};

module.exports = { signToken, authenticate, requireRole };
