-- Allows cancelled appointment slots to be booked again while preserving
-- cancelled appointment history.
--
-- The original table constraint UNIQUE (slot_id) blocks a second appointment
-- from ever referencing the same slot, even after the first appointment is
-- cancelled. Replace it with a partial unique index that only blocks active
-- appointments from sharing a slot.

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS uq_appointments_slot;

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_active_slot
  ON appointments (slot_id)
  WHERE status <> 'cancelled';
