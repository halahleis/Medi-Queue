/**
 * Seed script for MediQueue.
 *
 * Creates a full demo catalog:
 *   - 16 departments
 *   - 3 doctors per department
 *   - staff accounts assigned to queues for at most 2 doctors each
 *   - 1 admin account
 *   - no patient accounts or appointments
 *
 * Run with: node scripts/seed.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, getClient } = require('../src/config/db');

const PASSWORD = 'Password123!';

const DEPARTMENTS = [
  ['Cardiology', 'Heart and cardiovascular care'],
  ['Dermatology', 'Skin, hair, and nail care'],
  ['Pediatrics', 'Medical care for children and adolescents'],
  ['Neurology', 'Brain, nerve, and nervous system care'],
  ['Orthopedics', 'Bone, joint, and muscle care'],
  ['Gynecology', 'Women health and reproductive care'],
  ['Ophthalmology', 'Eye care and vision treatment'],
  ['ENT (Ear, Nose, and Throat)', 'Ear, nose, throat, head, and neck care'],
  ['Gastroenterology', 'Digestive system care'],
  ['Urology', 'Urinary tract and male reproductive care'],
  ['Psychiatry', 'Mental health diagnosis and treatment'],
  ['Endocrinology', 'Hormone and metabolic disorder care'],
  ['Pulmonology', 'Lung and respiratory care'],
  ['Oncology', 'Cancer diagnosis and treatment'],
  ['Internal Medicine', 'Adult medicine and chronic disease care'],
  ['General Surgery', 'Surgical consultation and treatment'],
];

const DOCTOR_FIRST_NAMES = [
  'Sami', 'Maya', 'Karim',
  'Lina', 'Nour', 'Rami',
  'Hala', 'Omar', 'Yara',
  'Fadi', 'Dina', 'Tarek',
  'Rana', 'Ziad', 'Layla',
  'Nadine', 'Samir', 'Jad',
  'Mira', 'Hussein', 'Salma',
  'Rita', 'Imad', 'Lea',
  'Farah', 'Nabil', 'Sara',
  'Mazen', 'Aline', 'Walid',
  'Mona', 'Bassel', 'Reem',
  'George', 'Celine', 'Ali',
  'Nadia', 'Joseph', 'Lara',
  'Hadi', 'Carla', 'Michel',
  'Rayan', 'Elie', 'Dana',
  'Zeina', 'Marwan', 'Amal',
];

const LAST_NAMES = [
  'Khalil', 'Haddad', 'Mansour', 'Nassar', 'Khoury', 'Saab',
  'Farah', 'Aoun', 'Karam', 'Saliba', 'Youssef', 'Maalouf',
];

const STAFF_NAMES = [
  ['Maria', 'Haddad'], ['Rima', 'Khalil'], ['Nour', 'Mansour'], ['Tala', 'Nassar'],
  ['Jana', 'Khoury'], ['Mira', 'Saab'], ['Leen', 'Farah'], ['Yasmin', 'Aoun'],
  ['Maya', 'Karam'], ['Rita', 'Saliba'], ['Sara', 'Youssef'], ['Dina', 'Maalouf'],
  ['Lara', 'Haddad'], ['Carla', 'Khalil'], ['Hiba', 'Mansour'], ['Mona', 'Nassar'],
  ['Nadine', 'Khoury'], ['Zeina', 'Saab'], ['Layla', 'Farah'], ['Celine', 'Aoun'],
  ['Amal', 'Karam'], ['Rana', 'Saliba'], ['Farah', 'Youssef'], ['Reem', 'Maalouf'],
  ['Aline', 'Haddad'], ['Dana', 'Khalil'], ['Joelle', 'Mansour'], ['Lina', 'Nassar'],
  ['Nadia', 'Khoury'], ['Samar', 'Saab'], ['Hala', 'Farah'], ['Lea', 'Aoun'],
];

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await ensureAssignmentSchema(client);

    console.log('Clearing existing seed/catalog and operational data...');
    await client.query(
      `TRUNCATE TABLE
         audit_logs, chat_messages, patient_staff_messages, patient_staff_conversations,
         queue_entries, notifications, payments,
         prescriptions, consultation_records, medical_documents, appointments,
         appointment_slots, doctor_unavailabilities, doctor_schedules,
         staff_doctor_assignments, doctors, staff, patients, departments, users
       RESTART IDENTITY CASCADE`
    );

    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    await insertUser(client, 'admin@mediqueue.test', passwordHash, '+9611000001', 'admin');

    const departmentRows = [];
    for (const [name, description] of DEPARTMENTS) {
      departmentRows.push(await insertDepartment(client, name, description));
    }

    const doctorsByDepartment = new Map();
    const doctorAccounts = [];
    let doctorIndex = 0;
    for (const department of departmentRows) {
      const doctors = [];
      for (let i = 0; i < 3; i++) {
        const firstName = DOCTOR_FIRST_NAMES[doctorIndex % DOCTOR_FIRST_NAMES.length];
        const lastName = LAST_NAMES[doctorIndex % LAST_NAMES.length];
        const emailSlug = `${firstName}.${lastName}.${department.name}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '.')
          .replace(/^\.+|\.+$/g, '');
        const user = await insertUser(
          client,
          `${emailSlug}@mediqueue.test`,
          passwordHash,
          `+96170${String(100000 + doctorIndex).slice(-6)}`,
          'doctor'
        );
        const doctor = await insertDoctor(client, user.id, department.id, {
          fullName: `Dr. ${firstName} ${lastName}`,
          specialty: specialtyFor(department.name),
          qualifications: 'MD',
          biography: `${specialtyFor(department.name)} serving MediQueue patients.`,
          standardFee: 80,
          followupFee: 50,
          duration: 20,
        });
        await insertWeeklySchedule(client, doctor.id);
        doctors.push(doctor);
        doctorAccounts.push({
          email: user.email,
          fullName: doctor.full_name,
          departmentName: department.name,
        });
        doctorIndex++;
      }
      doctorsByDepartment.set(department.name, doctors);
    }

    const staffAccounts = await insertStaffAssignments(client, passwordHash, departmentRows, doctorsByDepartment);

    await client.query('COMMIT');

    console.log('\nSeed complete.');
    console.log(`Password for all seeded accounts: ${PASSWORD}`);
    console.log('\nAdmin account:');
    console.log('  admin@mediqueue.test');
    console.log('\nStaff accounts:');
    for (const account of staffAccounts) {
      console.log(`  ${account.email} - ${account.fullName} - ${account.departmentName} - ${account.doctors.map((doctor) => doctor.full_name).join(', ')}`);
    }
    console.log('\nDoctor accounts:');
    for (const account of doctorAccounts) {
      console.log(`  ${account.email} - ${account.fullName} - ${account.departmentName}`);
    }
    console.log(`Created ${departmentRows.length} departments and ${departmentRows.length * 3} doctors.`);
    console.log(`Created ${staffAccounts.length} staff accounts.`);
    console.log('No patients, appointments, or queue entries were seeded.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

async function ensureAssignmentSchema(client) {
  const sqlPath = path.join(__dirname, 'staff_department_assignments.sql');
  await client.query(fs.readFileSync(sqlPath, 'utf8'));
  const communicationSqlPath = path.join(__dirname, 'patient_staff_communication_schema.sql');
  await client.query(fs.readFileSync(communicationSqlPath, 'utf8'));
}

async function insertUser(client, email, passwordHash, phone, role) {
  const result = await client.query(
    `INSERT INTO users (email, password_hash, phone, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role`,
    [email, passwordHash, phone, role]
  );
  return result.rows[0];
}

async function insertDepartment(client, name, description) {
  const result = await client.query(
    `INSERT INTO departments (name, description)
     VALUES ($1, $2)
     RETURNING id, name`,
    [name, description]
  );
  return result.rows[0];
}

async function insertDoctor(client, userId, departmentId, info) {
  const result = await client.query(
    `INSERT INTO doctors
       (user_id, department_id, full_name, specialty, qualifications, biography,
        standard_fee, followup_fee, appointment_duration_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, full_name, standard_fee, followup_fee, appointment_duration_minutes`,
    [
      userId,
      departmentId,
      info.fullName,
      info.specialty,
      info.qualifications,
      info.biography,
      info.standardFee,
      info.followupFee,
      info.duration,
    ]
  );
  return result.rows[0];
}

async function insertWeeklySchedule(client, doctorId) {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const day of days) {
    await client.query(
      `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
       VALUES ($1, $2::day_of_week, '09:00', '17:00')`,
      [doctorId, day]
    );
  }
}

async function insertStaff(client, userId, departmentId, fullName, role) {
  const result = await client.query(
    `INSERT INTO staff (user_id, department_id, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, full_name`,
    [userId, departmentId, fullName, role]
  );
  return result.rows[0];
}

async function insertStaffAssignments(client, passwordHash, departmentRows, doctorsByDepartment) {
  const staffAccounts = [];
  let staffIndex = 0;

  for (const department of departmentRows) {
    const doctors = doctorsByDepartment.get(department.name) || [];
    const groups = [doctors.slice(0, 2), doctors.slice(2, 3)].filter((group) => group.length > 0);

    for (const group of groups) {
      const [firstName, lastName] = STAFF_NAMES[staffIndex % STAFF_NAMES.length];
      const departmentSlug = department.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '.')
        .replace(/^\.+|\.+$/g, '');
      const email = staffIndex === 0
        ? 'maria@mediqueue.test'
        : `${firstName}.${lastName}.${departmentSlug}.staff@mediqueue.test`.toLowerCase();
      const user = await insertUser(
        client,
        email,
        passwordHash,
        `+96171${String(200000 + staffIndex).slice(-6)}`,
        'staff'
      );
      const staff = await insertStaff(client, user.id, department.id, `${firstName} ${lastName}`, 'receptionist');

      for (const doctor of group) {
        await client.query(
          `INSERT INTO staff_doctor_assignments (staff_id, doctor_id)
           VALUES ($1, $2)`,
          [staff.id, doctor.id]
        );
      }

      staffAccounts.push({
        email,
        fullName: staff.full_name,
        departmentName: department.name,
        doctors: group,
      });
      staffIndex++;
    }
  }

  return staffAccounts;
}

function specialtyFor(departmentName) {
  const map = {
    Cardiology: 'Cardiologist',
    Dermatology: 'Dermatologist',
    Pediatrics: 'Pediatrician',
    Neurology: 'Neurologist',
    Orthopedics: 'Orthopedic Surgeon',
    Gynecology: 'Gynecologist',
    Ophthalmology: 'Ophthalmologist',
    'ENT (Ear, Nose, and Throat)': 'ENT Specialist',
    Gastroenterology: 'Gastroenterologist',
    Urology: 'Urologist',
    Psychiatry: 'Psychiatrist',
    Endocrinology: 'Endocrinologist',
    Pulmonology: 'Pulmonologist',
    Oncology: 'Oncologist',
    'Internal Medicine': 'Internist',
    'General Surgery': 'General Surgeon',
  };
  return map[departmentName] || departmentName;
}

seed();
