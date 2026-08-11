require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, getClient } = require('../src/config/db');

const PASSWORD = 'Password123!';

const DEPARTMENTS = [
  'Cardiology',
  'Dermatology',
  'Pediatrics',
  'Neurology',
  'Orthopedics',
  'Gynecology',
  'Ophthalmology',
  'ENT (Ear, Nose, and Throat)',
  'Gastroenterology',
  'Urology',
  'Psychiatry',
  'Endocrinology',
  'Pulmonology',
  'Oncology',
  'Internal Medicine',
  'General Surgery',
];

async function main() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(fs.readFileSync(path.join(__dirname, 'staff_department_assignments.sql'), 'utf8'));

    await client.query(
      `TRUNCATE TABLE
         audit_logs, chat_messages, queue_entries, notifications, payments,
         prescriptions, consultation_records, medical_documents, appointments,
         appointment_slots, doctor_unavailabilities
       RESTART IDENTITY CASCADE`
    );

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const expectedDoctorEmails = DEPARTMENTS.flatMap((departmentName) => {
      const slug = departmentName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
      return [1, 2, 3].map((index) => `${slug}.doctor${index}@mediqueue.test`);
    });

    await client.query(
      `DELETE FROM users
        WHERE role = 'doctor'
          AND email LIKE '%@mediqueue.test'
          AND email <> ALL($1::text[])`,
      [expectedDoctorEmails]
    );
    await client.query(
      `DELETE FROM departments
        WHERE name <> ALL($1::text[])`,
      [DEPARTMENTS]
    );

    const departments = [];
    for (const name of DEPARTMENTS) {
      const result = await client.query(
        `INSERT INTO departments (name, description, is_active)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (name) DO UPDATE
           SET description = EXCLUDED.description,
               is_active = TRUE
         RETURNING id, name`,
        [name, `${name} department`]
      );
      departments.push(result.rows[0]);
    }

    for (const department of departments) {
      for (let index = 1; index <= 3; index++) {
        const slug = department.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
        const email = `${slug}.doctor${index}@mediqueue.test`;
        const user = await upsertUser(client, email, passwordHash, `+96171${String(departments.indexOf(department) * 3 + index).padStart(6, '0')}`, 'doctor');
        await client.query(
          `INSERT INTO doctors
             (user_id, department_id, full_name, specialty, qualifications, biography,
              standard_fee, followup_fee, appointment_duration_minutes, is_active)
           VALUES ($1, $2, $3, $4, 'MD', $5, 80, 50, 20, TRUE)
           ON CONFLICT (user_id) DO UPDATE
             SET department_id = EXCLUDED.department_id,
                 full_name = EXCLUDED.full_name,
                 specialty = EXCLUDED.specialty,
                 biography = EXCLUDED.biography,
                 is_active = TRUE
           RETURNING id`,
          [
            user.id,
            department.id,
            `Dr. ${department.name.replace(/\s*\(.+\)/, '')} ${index}`,
            specialtyFor(department.name),
            `${specialtyFor(department.name)} in the ${department.name} department.`,
          ]
        );
      }
    }

    const doctors = await client.query('SELECT id FROM doctors');
    for (const doctor of doctors.rows) {
      await ensureSchedule(client, doctor.id);
    }

    const cardiology = departments.find((department) => department.name === 'Cardiology');
    const staffUser = await upsertUser(client, 'maria@mediqueue.test', passwordHash, '+96171000002', 'staff');
    const staff = await client.query(
      `INSERT INTO staff (user_id, department_id, full_name, role, is_active)
       VALUES ($1, $2, 'Maria Haddad', 'receptionist', TRUE)
       ON CONFLICT (user_id) DO UPDATE
         SET department_id = EXCLUDED.department_id,
             full_name = EXCLUDED.full_name,
             role = EXCLUDED.role,
             is_active = TRUE
       RETURNING id`,
      [staffUser.id, cardiology.id]
    );

    await client.query('DELETE FROM staff_doctor_assignments WHERE staff_id = $1', [staff.rows[0].id]);
    const cardiologyDoctors = await client.query(
      `SELECT id FROM doctors
        WHERE department_id = $1
        ORDER BY full_name
        LIMIT 2`,
      [cardiology.id]
    );
    for (const doctor of cardiologyDoctors.rows) {
      await client.query(
        `INSERT INTO staff_doctor_assignments (staff_id, doctor_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [staff.rows[0].id, doctor.id]
      );
    }

    await client.query('COMMIT');
    console.log('Catalog update applied.');
    console.log('Operational appointment/queue data cleared.');
    console.log(`Departments ensured: ${departments.length}`);
    console.log('Doctors ensured: 3 per department.');
    console.log('Staff maria@mediqueue.test assigned to Cardiology and two Cardiology doctors.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

async function upsertUser(client, email, passwordHash, phone, role) {
  const result = await client.query(
    `INSERT INTO users (email, password_hash, phone, role, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           phone = EXCLUDED.phone,
           role = EXCLUDED.role,
           is_active = TRUE
     RETURNING id, email`,
    [email, passwordHash, phone, role]
  );
  return result.rows[0];
}

async function ensureSchedule(client, doctorId) {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const day of days) {
    await client.query(
      `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time, is_active)
       VALUES ($1, $2::day_of_week, '09:00', '17:00', TRUE)
       ON CONFLICT (doctor_id, day_of_week) DO UPDATE
         SET start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             is_active = TRUE`,
      [doctorId, day]
    );
  }
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

main();
