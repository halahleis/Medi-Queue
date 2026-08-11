require('dotenv').config();
const { pool } = require('../src/config/db');

async function main() {
  await pool.query(`
    UPDATE appointments a
       SET scheduled_at = (s.slot_date::text || ' ' || s.start_time::text)::timestamp,
           updated_at = NOW()
      FROM appointment_slots s
     WHERE s.id = a.slot_id
       AND a.scheduled_at::date IS DISTINCT FROM s.slot_date
  `);

  await pool.query(`
    UPDATE queue_entries qe
       SET queue_date = s.slot_date,
           scheduled_start_time = s.start_time,
           scheduled_end_time = s.end_time,
           updated_at = NOW()
      FROM appointments a
      JOIN appointment_slots s ON s.id = a.slot_id
     WHERE a.id = qe.appointment_id
       AND (
         qe.queue_date IS DISTINCT FROM s.slot_date
         OR qe.scheduled_start_time IS DISTINCT FROM s.start_time
         OR qe.scheduled_end_time IS DISTINCT FROM s.end_time
       )
  `);

  console.log('Shifted appointment dates repaired.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
