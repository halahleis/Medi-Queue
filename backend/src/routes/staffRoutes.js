const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/staffController');

const router = express.Router();

// All staff routes require auth + staff role.
router.use(authenticate, requireRole('staff'));

// Doctor list (for selector at top of board)
router.get('/doctors', c.listDoctors);

// Dashboard summary panel
router.get('/dashboard', c.dashboard);

// Board (kanban + schedule) for a given doctor + date
router.get('/board/:doctorId', c.getBoard);

// Card actions
router.post('/entries/:entryId/check-in',           c.checkIn);
router.post('/entries/:entryId/add-to-live',        c.addToLive);
router.post('/entries/:entryId/admit',              c.admit);
router.post('/entries/:entryId/complete',           c.complete);
router.post('/entries/:entryId/reject',             c.reject);
router.post('/entries/:entryId/no-show',            c.noShow);
router.post('/entries/:entryId/update-times',       c.updateTimes);
router.post('/entries/:entryId/action-required',    c.sendActionRequired);

// Global delay for a doctor's day
router.post('/board/:doctorId/global-delay', c.globalDelay);

// Search
router.get('/search', c.search);

// Doctor–staff chat
router.get('/chat/:doctorId',  c.listChat);
router.post('/chat/:doctorId', c.sendChat);

// End-of-day summary
router.get('/end-of-day', c.endOfDay);

module.exports = router;
