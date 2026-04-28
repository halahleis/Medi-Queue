/**
 * Public routes — accessible without authentication.
 * Used by the patient-facing homepage so anonymous visitors can browse
 * doctors and departments before deciding to register.
 */
const express = require('express');
const c = require('../controllers/patientController');

const router = express.Router();

router.get('/departments',     c.listDepartments);
router.get('/doctors',         c.listDoctors);
router.get('/doctors/:id',     c.getDoctor);

module.exports = router;
