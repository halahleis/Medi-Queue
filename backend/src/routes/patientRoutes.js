const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/patientController');

const router = express.Router();

// Every patient route requires patient role.
router.use(authenticate, requireRole('patient'));

// Profile
router.get   ('/profile',                c.getProfile);
router.put   ('/profile',                c.updateProfile);

// Browsing
router.get   ('/departments',            c.listDepartments);
router.get   ('/doctors',                c.listDoctors);
router.get   ('/doctors/:id',            c.getDoctor);
router.get   ('/doctors/:id/slots',      c.getDoctorSlots);

// Booking flow
router.post  ('/holds',                  c.holdSlot);
router.delete('/holds/:slotId',          c.releaseHold);
router.post  ('/appointments',           c.bookAppointment);

// My appointments
router.get   ('/appointments',           c.listMyAppointments);
router.post  ('/appointments/:id/cancel',c.cancelAppointment);

// Payment
router.post  ('/appointments/:id/pay',   c.payAppointment);

// Live status & self check-in
router.get   ('/live-status',            c.getLiveStatus);
router.post  ('/check-in',               c.selfCheckIn);

// Notifications
router.get   ('/notifications',          c.listNotifications);

// Patient <-> staff communication
router.get   ('/staff-contact-options',       c.listTodayContactOptions);
router.get   ('/staff-conversation',          c.getStaffConversation);
router.post  ('/staff-conversation/messages', c.sendStaffMessage);

module.exports = router;
