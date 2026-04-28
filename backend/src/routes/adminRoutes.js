const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const c = require('../controllers/adminController');

const router = express.Router();

// Every admin route requires admin role.
router.use(authenticate, requireRole('admin'));

router.get('/overview', c.overview);

// Departments
router.get   ('/departments',           c.listDepartments);
router.post  ('/departments',           c.createDepartment);
router.put   ('/departments/:id',       c.updateDepartment);
router.patch ('/departments/:id/active',c.setDepartmentActive);

// Doctors
router.get   ('/doctors',               c.listDoctors);
router.post  ('/doctors',               c.createDoctor);
router.put   ('/doctors/:id',           c.updateDoctor);
router.patch ('/doctors/:id/active',    c.setDoctorActive);
router.post  ('/doctors/:id/password',  c.resetDoctorPassword);

// Staff
router.get   ('/staff',                 c.listStaff);
router.post  ('/staff',                 c.createStaff);
router.put   ('/staff/:id',             c.updateStaff);
router.patch ('/staff/:id/active',      c.setStaffActive);
router.post  ('/staff/:id/password',    c.resetStaffPassword);

// Reports
router.get   ('/reports',               c.reports);

module.exports = router;
