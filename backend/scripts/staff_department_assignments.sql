ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS department_id UUID;

ALTER TABLE staff
  DROP CONSTRAINT IF EXISTS fk_staff_department;

ALTER TABLE staff
  ADD CONSTRAINT fk_staff_department
  FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS staff_doctor_assignments (
    staff_id   UUID NOT NULL,
    doctor_id  UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_staff_doctor_assignments PRIMARY KEY (staff_id, doctor_id),
    CONSTRAINT fk_staff_doctor_assignments_staff
      FOREIGN KEY (staff_id) REFERENCES staff (id) ON DELETE CASCADE,
    CONSTRAINT fk_staff_doctor_assignments_doctor
      FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_staff_doctor_assignments_staff
  ON staff_doctor_assignments (staff_id);

CREATE INDEX IF NOT EXISTS idx_staff_doctor_assignments_doctor
  ON staff_doctor_assignments (doctor_id);

CREATE OR REPLACE FUNCTION enforce_staff_doctor_assignment_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  staff_department UUID;
  doctor_department UUID;
  assignment_count INTEGER;
BEGIN
  SELECT department_id INTO staff_department
    FROM staff
   WHERE id = NEW.staff_id;

  SELECT department_id INTO doctor_department
    FROM doctors
   WHERE id = NEW.doctor_id;

  IF staff_department IS NULL THEN
    RAISE EXCEPTION 'Staff member must belong to a department before doctor assignment.';
  END IF;

  IF doctor_department IS DISTINCT FROM staff_department THEN
    RAISE EXCEPTION 'Staff can only be assigned to doctors in their department.';
  END IF;

  SELECT COUNT(*) INTO assignment_count
    FROM staff_doctor_assignments
   WHERE staff_id = NEW.staff_id
     AND doctor_id <> NEW.doctor_id;

  IF assignment_count >= 2 THEN
    RAISE EXCEPTION 'Staff can be assigned to at most two doctors.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_staff_doctor_assignment_rules ON staff_doctor_assignments;
CREATE TRIGGER trg_staff_doctor_assignment_rules
  BEFORE INSERT OR UPDATE ON staff_doctor_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_staff_doctor_assignment_rules();
