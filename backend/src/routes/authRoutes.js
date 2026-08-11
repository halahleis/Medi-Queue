const express = require('express');
const { login, me, forgotPassword, resetPassword } = require('../controllers/authController');
const { register } = require('../controllers/patientController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, me);

module.exports = router;
