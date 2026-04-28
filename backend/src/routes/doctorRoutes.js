const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/doctorController');

const router = express.Router();
router.use(authenticate, requireRole('doctor'));

// Dashboard + board
router.get   ('/dashboard',                          c.dashboard);
router.get   ('/board',                              c.getBoard);
router.post  ('/entries/:entryId/complete',          c.completeVisit);

// Patient/appointment context
router.get   ('/appointments/:appointmentId/patient', c.getPatientForAppointment);

// Consultation records & prescriptions
router.post  ('/appointments/:appointmentId/consultation', c.saveConsultation);
router.post  ('/consultations/:consultationId/prescriptions', c.addPrescription);
router.delete('/prescriptions/:id',                  c.deletePrescription);

// Profile (self)
router.get   ('/profile',                            c.getMyProfile);
router.put   ('/profile',                            c.updateMyProfile);

// Schedule
router.get   ('/schedule',                           c.getMySchedule);
router.put   ('/schedule',                           c.updateMySchedule);
router.post  ('/unavailabilities',                   c.addUnavailability);
router.delete('/unavailabilities/:id',               c.removeUnavailability);

// Chat
router.get   ('/chat',                               c.listChat);
router.post  ('/chat',                               c.sendChat);

module.exports = router;
