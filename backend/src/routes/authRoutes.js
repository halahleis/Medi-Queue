const express = require('express');
const { login, me } = require('../controllers/authController');
const { register } = require('../controllers/patientController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.get('/me', authenticate, me);

module.exports = router;
