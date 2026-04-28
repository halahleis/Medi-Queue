/**
 * Seed script for MediQueue.
 *
 * Creates:
 *   - 2 departments (Cardiology, General Medicine)
 *   - 2 doctors (1 active in each department) with weekly schedules
 *   - 1 staff account
 *   - 1 admin account
 *   - 6 patients
 *   - Today's appointments + queue entries for Dr. Khalil with mixed states:
 *       upcoming, waiting (early/on-time/late), in-consultation, completed
 *
 * Run with:  node scripts/seed.js
 *
 * Login credentials after seeding:
 *   Staff:   maria@mediqueue.test  /  password123
 *   Doctor:  khalil@mediqueue.test /  password123
 *   Admin:   admin@mediqueue.test  /  password123
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query, getClient } = require('../src/config/db');
const { todayDateStr } = require('../src/utils/time');

const PASSWORD = 'password123';

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    console.log('🧹 Wiping existing operational data (keeping schema)...');
    // Order matters because of foreign keys.
    await client.query('TRUNCATE TABLE audit_logs, chat_messages, queue_entries, notifications, payments, prescriptions, consultation_records, medical_documents, appointments, appointment_slots, doctor_unavailabilities, doctor_schedules, doctors, staff, patients, departments, users RESTART IDENTITY CASCADE');

    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    /* ------------------------------ Users ------------------------------ */
    console.log('👤 Creating users...');
    const adminUser  = await insertUser(client, 'admin@mediqueue.test',   passwordHash, '+961 1 000001', 'admin');
    const staffUser  = await insertUser(client, 'maria@mediqueue.test',   passwordHash, '+961 1 000002', 'staff');
    const doc1User   = await insertUser(client, 'khalil@mediqueue.test',  passwordHash, '+961 1 000003', 'doctor');
    const doc2User   = await insertUser(client, 'mansour@mediqueue.test', passwordHash, '+961 1 000004', 'doctor');

    const patientUsers = [];
    for (let i = 1; i <= 6; i++) {
      const u = await insertUser(client, `patient${i}@mediqueue.test`, passwordHash, `+961 1 10000${i}`, 'patient');
      patientUsers.push(u);
    }

    /* --------------------------- Departments --------------------------- */
    console.log('🏥 Creating departments...');
    const depCardiology = await insertDept(client, 'Cardiology', 'Heart-related care');
    const depGeneral    = await insertDept(client, 'General Medicine', 'Primary care');

    /* ---------------------------- Doctors ----------------------------- */
    console.log('👨‍⚕️ Creating doctors...');
    const doc1 = await insertDoctor(client, doc1User.id, depCardiology.id, {
      full_name: 'Dr. Sami Khalil',
      specialty: 'Cardiologist',
      qualifications: 'MD, FACC',
      biography: 'Senior cardiologist with 15+ years of experience treating cardiovascular conditions.',
      standard_fee: 80,
      followup_fee: 50,
      duration: 20,
    });
    const doc2 = await insertDoctor(client, doc2User.id, depGeneral.id, {
      full_name: 'Dr. Omar Mansour',
      specialty: 'General Physician',
      qualifications: 'MBBS',
      biography: 'General practitioner focused on preventive medicine and family health.',
      standard_fee: 50,
      followup_fee: 30,
      duration: 15,
    });

    /* ----------------------- Doctor weekly schedule ----------------------- */
    console.log('📅 Creating doctor weekly schedules...');
    // Schema enforces UNIQUE(doctor_id, day_of_week), so one row per day per doctor.
    // Both doctors work every day in the seed (so it works regardless of the day you run it).
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    for (const day of days) {
      await client.query(
        `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
         VALUES ($1, $2::day_of_week, '09:00', '17:00')`,
        [doc1.id, day]
      );
      await client.query(
        `INSERT INTO doctor_schedules (doctor_id, day_of_week, start_time, end_time)
         VALUES ($1, $2::day_of_week, '09:00', '17:00')`,
        [doc2.id, day]
      );
    }

    /* ----------------------------- Staff ----------------------------- */
    console.log('🧑‍💼 Creating staff record...');
    const staffRow = await client.query(
      `INSERT INTO staff (user_id, full_name, role) VALUES ($1, $2, $3) RETURNING id`,
      [staffUser.id, 'Maria Haddad', 'receptionist']
    );
    const staffId = staffRow.rows[0].id;

    /* --------------------------- Patients ---------------------------- */
    console.log('🧑‍🤝‍🧑 Creating patients...');
    const patientNames = [
      'A. Khan',
      'B. Chen',
      'C. Davis',
      'D. Evans',
      'E. Fisher',
      'F. Garcia',
    ];
    const patients = [];
    for (let i = 0; i < patientUsers.length; i++) {
      const r = await client.query(
        `INSERT INTO patients (user_id, full_name, blood_type)
         VALUES ($1, $2, $3) RETURNING id, full_name`,
        [patientUsers[i].id, patientNames[i], ['A+', 'O+', 'B+', 'AB+', 'O-', 'A-'][i]]
      );
      patients.push(r.rows[0]);
    }

    /* ------------------- Today's appointments for Dr Khalil ------------------- */
    console.log('🗓️  Creating today\'s appointments + queue entries for Dr. Khalil...');
    const today = todayDateStr();

    // We'll fabricate slots starting at 09:00 with 20-min duration.
    // Each row: [start, end, kanbanState, arrivalTag, actualStart, actualEnd, arrivedAtTime]
    // arrivedAtTime is a "HH:MM" string used to override the default arrival time
    // (handy for demo-ing the late label).
    const apptSpecs = [
      ['09:00', '09:20', 'completed',       'on_time', '09:02', '09:18', '09:00'],
      ['09:20', '09:40', 'in_consultation', 'on_time', '09:22', null,    '09:18'],
      ['09:40', '10:00', 'waiting',         'early',   null,    null,    '09:35'],
      ['10:00', '10:20', 'waiting',         'on_time', null,    null,    '10:01'],
      // E. Fisher: scheduled 10:20, arrived 25 min late at 10:45.
      ['10:20', '10:40', 'waiting',         'late',    null,    null,    '10:45'],
      ['10:40', '11:00', 'upcoming',        null,      null,    null,    null],
    ];

    for (let i = 0; i < apptSpecs.length; i++) {
      const [start, end, kanban, tag, aStart, aEnd, arrivedTime] = apptSpecs[i];
      const patient = patients[i];

      // Slot
      const slotRes = await client.query(
        `INSERT INTO appointment_slots (doctor_id, slot_date, start_time, end_time, status)
         VALUES ($1, $2, $3, $4, 'booked')
         RETURNING id`,
        [doc1.id, today, start, end]
      );
      const slotId = slotRes.rows[0].id;

      // Determine appointment status
      let apptStatus = 'confirmed';
      if (kanban === 'completed') apptStatus = 'completed';

      const apptRes = await client.query(
        `INSERT INTO appointments
           (patient_id, doctor_id, slot_id, visit_type, status, payment_status, payment_method, fee_charged, scheduled_at)
         VALUES ($1, $2, $3, 'new_consultation', $4, 'cash_paid', 'cash', $5, ($6 || ' ' || $7)::timestamp)
         RETURNING id`,
        [patient.id, doc1.id, slotId, apptStatus, doc1.standard_fee, today, start]
      );
      const apptId = apptRes.rows[0].id;

      // Queue entry
      const arrivedAt = arrivedTime
        ? `${today} ${arrivedTime}:00`
        : null;

      const admittedAt = (kanban === 'in_consultation' || kanban === 'completed')
        ? `${today} ${aStart}:00`
        : null;

      const consEndAt = kanban === 'completed' ? `${today} ${aEnd}:00` : null;

      await client.query(
        `INSERT INTO queue_entries
           (appointment_id, staff_id, queue_date, doctor_id, position, kanban_status,
            arrival_tag, arrived_at, admitted_at, consultation_end_at,
            scheduled_start_time, scheduled_end_time, actual_start_time, actual_end_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          apptId,
          staffId,
          today,
          doc1.id,
          ['waiting', 'in_consultation'].includes(kanban) ? i + 1 : null,
          kanban,
          tag,
          arrivedAt,
          admittedAt,
          consEndAt,
          start,
          end,
          aStart,
          aEnd,
        ]
      );
    }

    /* --------------- A couple of upcoming appts for Dr Mansour --------------- */
    for (let i = 0; i < 2; i++) {
      const start = `1${i}:00`;
      const end   = `1${i}:15`;
      const patient = patients[i];
      const slotRes = await client.query(
        `INSERT INTO appointment_slots (doctor_id, slot_date, start_time, end_time, status)
         VALUES ($1, $2, $3, $4, 'booked') RETURNING id`,
        [doc2.id, today, start, end]
      );
      await client.query(
        `INSERT INTO appointments
           (patient_id, doctor_id, slot_id, visit_type, status, payment_status, fee_charged, scheduled_at)
         VALUES ($1, $2, $3, 'new_consultation', 'confirmed', 'unpaid', $4, ($5 || ' ' || $6)::timestamp)`,
        [patient.id, doc2.id, slotRes.rows[0].id, doc2.standard_fee, today, start]
      );
    }

    /* ------------------------- Sample chat messages ------------------------- */
    console.log('💬 Adding sample chat messages...');
    await client.query(
      `INSERT INTO chat_messages (doctor_id, sender_user_id, message, session_date)
       VALUES ($1, $2, 'Good morning, the queue is ready when you are.', $3)`,
      [doc1.id, staffUser.id, today]
    );
    await client.query(
      `INSERT INTO chat_messages (doctor_id, sender_user_id, message, quick_action_type, session_date)
       VALUES ($1, $2, 'Ready for next patient in Room 4.', 'ready_for_next', $3)`,
      [doc1.id, doc1User.id, today]
    );

    await client.query('COMMIT');
    console.log('\n✅ Seed complete.\n');
    console.log('Login credentials (password is the same for all): password123');
    console.log('  Staff:   maria@mediqueue.test');
    console.log('  Doctor:  khalil@mediqueue.test  (Dr. Sami Khalil)');
    console.log('  Doctor:  mansour@mediqueue.test (Dr. Omar Mansour)');
    console.log('  Admin:   admin@mediqueue.test\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

/* ---------- helpers ---------- */
async function insertUser(client, email, passwordHash, phone, role) {
  const r = await client.query(
    `INSERT INTO users (email, password_hash, phone, role)
     VALUES ($1, $2, $3, $4) RETURNING id, email, role`,
    [email, passwordHash, phone, role]
  );
  return r.rows[0];
}
async function insertDept(client, name, description) {
  const r = await client.query(
    `INSERT INTO departments (name, description) VALUES ($1, $2) RETURNING id, name`,
    [name, description]
  );
  return r.rows[0];
}
async function insertDoctor(client, userId, departmentId, info) {
  const r = await client.query(
    `INSERT INTO doctors
       (user_id, department_id, full_name, specialty, qualifications, biography,
        standard_fee, followup_fee, appointment_duration_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, full_name, standard_fee, followup_fee`,
    [
      userId, departmentId, info.full_name, info.specialty,
      info.qualifications, info.biography,
      info.standard_fee, info.followup_fee, info.duration,
    ]
  );
  return r.rows[0];
}

seed();