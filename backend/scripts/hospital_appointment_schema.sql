-- =============================================================================
-- Hospital Appointment System — PostgreSQL DDL
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()


-- ---------------------------------------------------------------------------
-- ENUM Types
-- ---------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM (
    'patient',
    'doctor',
    'staff',
    'admin'
);

CREATE TYPE day_of_week AS ENUM (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
);

CREATE TYPE slot_status AS ENUM (
    'available',
    'reserved',   -- temporarily held during booking
    'booked',
    'blocked'     -- falls in a doctor unavailability window
);

CREATE TYPE visit_type AS ENUM (
    'new_consultation',
    'follow_up'
);

CREATE TYPE appointment_status AS ENUM (
    'pending_payment',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
);

CREATE TYPE payment_status AS ENUM (
    'unpaid',
    'online_paid',
    'cash_paid',
    'refunded'
);

CREATE TYPE payment_method AS ENUM (
    'online',
    'cash'
);

CREATE TYPE kanban_status AS ENUM (
    'upcoming',
    'waiting',
    'in_consultation',
    'completed',
    'rejected',
    'no_show'
);

CREATE TYPE arrival_tag AS ENUM (
    'early',
    'on_time',
    'late'
);

CREATE TYPE notification_channel AS ENUM (
    'email',
    'sms',
    'push'
);

CREATE TYPE notification_status AS ENUM (
    'pending',
    'sent',
    'failed',
    'retrying'
);


-- =============================================================================
-- TABLES
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. USERS  (single auth/identity table for all roles)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    phone           VARCHAR(30),
    role            user_role   NOT NULL,
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT chk_users_email_format CHECK (email ~* '^[^@]+@[^@]+\.[^@]+$')
);

CREATE INDEX idx_users_email   ON users (email);
CREATE INDEX idx_users_role    ON users (role);


-- ---------------------------------------------------------------------------
-- 2. PATIENTS
-- ---------------------------------------------------------------------------
CREATE TABLE patients (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                     UUID        NOT NULL,
    full_name                   VARCHAR(255) NOT NULL,
    blood_type                  VARCHAR(5),
    allergies                   TEXT,
    chronic_conditions          TEXT,
    current_medications         TEXT,
    insurance_provider          VARCHAR(255),
    insurance_number            VARCHAR(100),
    emergency_contact_name      VARCHAR(255),
    emergency_contact_phone     VARCHAR(30),
    created_at                  TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_patients_user    FOREIGN KEY (user_id)  REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_patients_user_id UNIQUE (user_id),
    CONSTRAINT chk_patients_blood_type CHECK (
        blood_type IS NULL OR blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')
    )
);

CREATE INDEX idx_patients_user_id   ON patients (user_id);
CREATE INDEX idx_patients_full_name ON patients (full_name);


-- ---------------------------------------------------------------------------
-- 3. DEPARTMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE departments (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_departments_name UNIQUE (name)
);


-- ---------------------------------------------------------------------------
-- 4. DOCTORS
-- ---------------------------------------------------------------------------
CREATE TABLE doctors (
    id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                         UUID        NOT NULL,
    department_id                   UUID        NOT NULL,
    full_name                       VARCHAR(255) NOT NULL,
    specialty                       VARCHAR(255) NOT NULL,
    qualifications                  TEXT,
    biography                       TEXT,
    consultation_instructions       TEXT,
    profile_picture_url             VARCHAR(500),
    standard_fee                    NUMERIC(10,2) NOT NULL DEFAULT 0,
    followup_fee                    NUMERIC(10,2) NOT NULL DEFAULT 0,
    appointment_duration_minutes    INTEGER     NOT NULL DEFAULT 15,
    is_active                       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at                      TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_doctors_user        FOREIGN KEY (user_id)       REFERENCES users (id)       ON DELETE CASCADE,
    CONSTRAINT fk_doctors_department  FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT,
    CONSTRAINT uq_doctors_user_id     UNIQUE (user_id),
    CONSTRAINT chk_doctors_standard_fee  CHECK (standard_fee  >= 0),
    CONSTRAINT chk_doctors_followup_fee  CHECK (followup_fee  >= 0),
    CONSTRAINT chk_doctors_duration      CHECK (appointment_duration_minutes > 0)
);

CREATE INDEX idx_doctors_user_id       ON doctors (user_id);
CREATE INDEX idx_doctors_department_id ON doctors (department_id);
CREATE INDEX idx_doctors_is_active     ON doctors (is_active);


-- ---------------------------------------------------------------------------
-- 5. STAFF
-- ---------------------------------------------------------------------------
CREATE TABLE staff (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL,
    full_name   VARCHAR(255) NOT NULL,
    role        VARCHAR(100) NOT NULL DEFAULT 'receptionist',
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_staff_user    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_staff_user_id UNIQUE (user_id)
);

CREATE INDEX idx_staff_user_id ON staff (user_id);


-- ---------------------------------------------------------------------------
-- 6. DOCTOR_SCHEDULES  (recurring weekly availability)
-- ---------------------------------------------------------------------------
CREATE TABLE doctor_schedules (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id     UUID        NOT NULL,
    day_of_week   day_of_week NOT NULL,
    start_time    TIME        NOT NULL,
    end_time      TIME        NOT NULL,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,

    CONSTRAINT fk_doctor_schedules_doctor FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE,
    CONSTRAINT uq_doctor_schedules_day    UNIQUE (doctor_id, day_of_week),
    CONSTRAINT chk_doctor_schedules_times CHECK (end_time > start_time)
);

CREATE INDEX idx_doctor_schedules_doctor_id ON doctor_schedules (doctor_id);


-- ---------------------------------------------------------------------------
-- 7. DOCTOR_UNAVAILABILITIES  (one-off day-offs and blocked intervals)
-- ---------------------------------------------------------------------------
CREATE TABLE doctor_unavailabilities (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id           UUID        NOT NULL,
    unavailable_date    DATE        NOT NULL,
    block_start_time    TIME,           -- NULL when is_full_day = TRUE
    block_end_time      TIME,           -- NULL when is_full_day = TRUE
    reason              VARCHAR(255),
    is_full_day         BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_doctor_unavailabilities_doctor FOREIGN KEY (doctor_id) REFERENCES doctors (id) ON DELETE CASCADE,
    CONSTRAINT chk_doctor_unavailabilities_times CHECK (
        (is_full_day = TRUE  AND block_start_time IS NULL AND block_end_time IS NULL)
     OR (is_full_day = FALSE AND block_start_time IS NOT NULL AND block_end_time IS NOT NULL AND block_end_time > block_start_time)
    )
);

CREATE INDEX idx_doctor_unavailabilities_doctor_date ON doctor_unavailabilities (doctor_id, unavailable_date);


-- ---------------------------------------------------------------------------
-- 8. APPOINTMENT_SLOTS  (generated bookable slots)
-- ---------------------------------------------------------------------------
CREATE TABLE appointment_slots (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id               UUID        NOT NULL,
    slot_date               DATE        NOT NULL,
    start_time              TIME        NOT NULL,
    end_time                TIME        NOT NULL,
    status                  slot_status NOT NULL DEFAULT 'available',
    reserved_by_patient_id  UUID,       -- set during the booking hold window
    reservation_expires_at  TIMESTAMP,  -- cleared once booked or expired
    created_at              TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_appointment_slots_doctor  FOREIGN KEY (doctor_id)              REFERENCES doctors  (id) ON DELETE CASCADE,
    CONSTRAINT fk_appointment_slots_patient FOREIGN KEY (reserved_by_patient_id) REFERENCES patients (id) ON DELETE SET NULL,
    CONSTRAINT uq_appointment_slots        UNIQUE (doctor_id, slot_date, start_time),
    CONSTRAINT chk_appointment_slots_times CHECK (end_time > start_time),
    CONSTRAINT chk_appointment_slots_reservation CHECK (
        (status = 'reserved' AND reserved_by_patient_id IS NOT NULL AND reservation_expires_at IS NOT NULL)
     OR (status <> 'reserved')
    )
);

CREATE INDEX idx_appointment_slots_doctor_date ON appointment_slots (doctor_id, slot_date);
CREATE INDEX idx_appointment_slots_status      ON appointment_slots (status);
CREATE INDEX idx_appointment_slots_expiry      ON appointment_slots (reservation_expires_at) WHERE status = 'reserved';


-- ---------------------------------------------------------------------------
-- 9. APPOINTMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE appointments (
    id                      UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id              UUID                NOT NULL,
    doctor_id               UUID                NOT NULL,
    slot_id                 UUID                NOT NULL,
    visit_type              visit_type          NOT NULL DEFAULT 'new_consultation',
    status                  appointment_status  NOT NULL DEFAULT 'pending_payment',
    payment_status          payment_status      NOT NULL DEFAULT 'unpaid',
    payment_method          payment_method,
    is_followup             BOOLEAN             NOT NULL DEFAULT FALSE,
    parent_appointment_id   UUID,               -- links to the original consultation for follow-ups
    fee_charged             NUMERIC(10,2)       NOT NULL DEFAULT 0,
    scheduled_at            TIMESTAMP           NOT NULL,
    created_at              TIMESTAMP           NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP           NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_appointments_patient     FOREIGN KEY (patient_id)            REFERENCES patients     (id) ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_doctor      FOREIGN KEY (doctor_id)             REFERENCES doctors      (id) ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_slot        FOREIGN KEY (slot_id)               REFERENCES appointment_slots (id) ON DELETE RESTRICT,
    CONSTRAINT fk_appointments_parent      FOREIGN KEY (parent_appointment_id) REFERENCES appointments (id) ON DELETE SET NULL,
    CONSTRAINT uq_appointments_slot        UNIQUE (slot_id),
    CONSTRAINT chk_appointments_fee        CHECK (fee_charged >= 0),
    CONSTRAINT chk_appointments_followup   CHECK (
        (is_followup = TRUE  AND visit_type = 'follow_up')
     OR (is_followup = FALSE)
    ),
    CONSTRAINT chk_appointments_no_self_ref CHECK (id <> parent_appointment_id)
);

CREATE INDEX idx_appointments_patient_id    ON appointments (patient_id);
CREATE INDEX idx_appointments_doctor_id     ON appointments (doctor_id);
CREATE INDEX idx_appointments_status        ON appointments (status);
CREATE INDEX idx_appointments_scheduled_at  ON appointments (scheduled_at);
CREATE INDEX idx_appointments_parent_id     ON appointments (parent_appointment_id) WHERE parent_appointment_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 10. CONSULTATION_RECORDS
-- ---------------------------------------------------------------------------
CREATE TABLE consultation_records (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id          UUID        NOT NULL,
    doctor_id               UUID        NOT NULL,
    symptoms                TEXT,
    diagnosis               TEXT,
    treatment_plan          TEXT,
    recommendations         TEXT,
    followup_recommended    BOOLEAN     NOT NULL DEFAULT FALSE,
    followup_by_date        DATE,
    recorded_at             TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_consultation_records_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT,
    CONSTRAINT fk_consultation_records_doctor      FOREIGN KEY (doctor_id)      REFERENCES doctors      (id) ON DELETE RESTRICT,
    CONSTRAINT uq_consultation_records_appointment UNIQUE (appointment_id),
    CONSTRAINT chk_consultation_records_followup CHECK (
        (followup_recommended = TRUE  AND followup_by_date IS NOT NULL)
     OR (followup_recommended = FALSE)
    )
);

CREATE INDEX idx_consultation_records_doctor_id ON consultation_records (doctor_id);


-- ---------------------------------------------------------------------------
-- 11. PRESCRIPTIONS
-- ---------------------------------------------------------------------------
CREATE TABLE prescriptions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id     UUID        NOT NULL,
    doctor_id           UUID        NOT NULL,
    patient_id          UUID        NOT NULL,
    medication_name     TEXT        NOT NULL,
    dosage              TEXT        NOT NULL,
    instructions        TEXT,
    issued_date         DATE        NOT NULL DEFAULT CURRENT_DATE,
    valid_until         DATE,

    CONSTRAINT fk_prescriptions_consultation FOREIGN KEY (consultation_id) REFERENCES consultation_records (id) ON DELETE RESTRICT,
    CONSTRAINT fk_prescriptions_doctor       FOREIGN KEY (doctor_id)       REFERENCES doctors              (id) ON DELETE RESTRICT,
    CONSTRAINT fk_prescriptions_patient      FOREIGN KEY (patient_id)      REFERENCES patients             (id) ON DELETE RESTRICT,
    CONSTRAINT chk_prescriptions_dates CHECK (valid_until IS NULL OR valid_until >= issued_date)
);

CREATE INDEX idx_prescriptions_consultation_id ON prescriptions (consultation_id);
CREATE INDEX idx_prescriptions_patient_id      ON prescriptions (patient_id);
CREATE INDEX idx_prescriptions_doctor_id       ON prescriptions (doctor_id);


-- ---------------------------------------------------------------------------
-- 12. MEDICAL_DOCUMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE medical_documents (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id              UUID        NOT NULL,
    uploaded_by_user_id     UUID        NOT NULL,
    appointment_id          UUID,       -- optional: linked to a specific appointment
    document_type           VARCHAR(100) NOT NULL,  -- e.g. 'scan', 'report', 'prescription', 'insurance_card'
    file_name               VARCHAR(255) NOT NULL,
    file_url                VARCHAR(500) NOT NULL,
    file_size_bytes         BIGINT      NOT NULL,
    mime_type               VARCHAR(100) NOT NULL,
    uploaded_at             TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_medical_documents_patient        FOREIGN KEY (patient_id)          REFERENCES patients      (id) ON DELETE RESTRICT,
    CONSTRAINT fk_medical_documents_uploaded_by    FOREIGN KEY (uploaded_by_user_id) REFERENCES users         (id) ON DELETE RESTRICT,
    CONSTRAINT fk_medical_documents_appointment    FOREIGN KEY (appointment_id)      REFERENCES appointments  (id) ON DELETE SET NULL,
    CONSTRAINT chk_medical_documents_file_size     CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880)  -- 5 MB max
);

CREATE INDEX idx_medical_documents_patient_id     ON medical_documents (patient_id);
CREATE INDEX idx_medical_documents_appointment_id ON medical_documents (appointment_id) WHERE appointment_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 13. PAYMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id          UUID            NOT NULL,
    patient_id              UUID            NOT NULL,
    amount                  NUMERIC(10,2)   NOT NULL,
    method                  payment_method  NOT NULL,
    status                  payment_status  NOT NULL DEFAULT 'unpaid',
    transaction_reference   VARCHAR(255),   -- gateway reference for online payments
    card_last_four          CHAR(4),
    card_brand              VARCHAR(50),    -- e.g. 'Visa', 'MasterCard'
    paid_at                 TIMESTAMP,
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_payments_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT,
    CONSTRAINT fk_payments_patient     FOREIGN KEY (patient_id)     REFERENCES patients     (id) ON DELETE RESTRICT,
    CONSTRAINT uq_payments_appointment UNIQUE (appointment_id),
    CONSTRAINT chk_payments_amount     CHECK (amount >= 0),
    CONSTRAINT chk_payments_card       CHECK (
        (method = 'online'  AND card_last_four IS NOT NULL AND card_brand IS NOT NULL)
     OR (method = 'cash')
    ),
    CONSTRAINT chk_payments_paid_at    CHECK (
        (status IN ('online_paid', 'cash_paid') AND paid_at IS NOT NULL)
     OR (status NOT IN ('online_paid', 'cash_paid'))
    )
);

CREATE INDEX idx_payments_appointment_id ON payments (appointment_id);
CREATE INDEX idx_payments_patient_id     ON payments (patient_id);
CREATE INDEX idx_payments_status         ON payments (status);


-- ---------------------------------------------------------------------------
-- 14. NOTIFICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
    id              UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID                    NOT NULL,
    appointment_id  UUID,
    type            VARCHAR(100)            NOT NULL,   -- e.g. 'reminder_24h', 'booking_confirmed', 'cancellation'
    channel         notification_channel    NOT NULL,
    title           VARCHAR(255)            NOT NULL,
    message         TEXT                    NOT NULL,
    status          notification_status     NOT NULL DEFAULT 'pending',
    scheduled_at    TIMESTAMP               NOT NULL,
    sent_at         TIMESTAMP,
    retry_count     INTEGER                 NOT NULL DEFAULT 0,
    created_at      TIMESTAMP               NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_notifications_user        FOREIGN KEY (user_id)        REFERENCES users        (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL,
    CONSTRAINT chk_notifications_retry      CHECK (retry_count >= 0)
);

CREATE INDEX idx_notifications_user_id        ON notifications (user_id);
CREATE INDEX idx_notifications_appointment_id ON notifications (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX idx_notifications_status         ON notifications (status);
CREATE INDEX idx_notifications_scheduled_at   ON notifications (scheduled_at) WHERE status = 'pending';


-- ---------------------------------------------------------------------------
-- 15. QUEUE_ENTRIES  (the live operational kanban per doctor per day)
-- ---------------------------------------------------------------------------
CREATE TABLE queue_entries (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id          UUID            NOT NULL,
    staff_id                UUID,           -- staff member who last acted on this entry
    queue_date              DATE            NOT NULL,
    doctor_id               UUID            NOT NULL,
    position                INTEGER,        -- ordering within the live schedule
    kanban_status           kanban_status   NOT NULL DEFAULT 'upcoming',
    arrival_tag             arrival_tag,    -- set once patient checks in
    arrived_at              TIMESTAMP,
    admitted_at             TIMESTAMP,
    consultation_end_at     TIMESTAMP,
    scheduled_start_time    TIME            NOT NULL,
    scheduled_end_time      TIME            NOT NULL,
    actual_start_time       TIME,
    actual_end_time         TIME,
    staff_notes             TEXT,
    rejection_reason        VARCHAR(255),
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP       NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_queue_entries_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE RESTRICT,
    CONSTRAINT fk_queue_entries_staff       FOREIGN KEY (staff_id)       REFERENCES staff        (id) ON DELETE SET NULL,
    CONSTRAINT fk_queue_entries_doctor      FOREIGN KEY (doctor_id)      REFERENCES doctors      (id) ON DELETE RESTRICT,
    CONSTRAINT uq_queue_entries_appointment UNIQUE (appointment_id),
    CONSTRAINT chk_queue_entries_times      CHECK (scheduled_end_time > scheduled_start_time),
    CONSTRAINT chk_queue_entries_actual     CHECK (
        actual_end_time IS NULL OR actual_start_time IS NULL OR actual_end_time >= actual_start_time
    ),
    CONSTRAINT chk_queue_entries_rejection  CHECK (
        (kanban_status = 'rejected' AND rejection_reason IS NOT NULL)
     OR (kanban_status <> 'rejected')
    ),
    CONSTRAINT chk_queue_entries_position   CHECK (position IS NULL OR position > 0)
);

CREATE INDEX idx_queue_entries_doctor_date    ON queue_entries (doctor_id, queue_date);
CREATE INDEX idx_queue_entries_kanban_status  ON queue_entries (kanban_status);
CREATE INDEX idx_queue_entries_appointment_id ON queue_entries (appointment_id);


-- ---------------------------------------------------------------------------
-- 16. CHAT_MESSAGES  (doctor–staff operational channel, scoped to one day)
-- ---------------------------------------------------------------------------
CREATE TABLE chat_messages (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id           UUID        NOT NULL,
    sender_user_id      UUID        NOT NULL,
    message             TEXT        NOT NULL,
    quick_action_type   VARCHAR(50),    -- e.g. 'running_late', 'ready_for_next', 'pause_queue'
    session_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
    sent_at             TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_chat_messages_doctor FOREIGN KEY (doctor_id)      REFERENCES doctors (id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users   (id) ON DELETE CASCADE,
    CONSTRAINT chk_chat_messages_not_empty CHECK (LENGTH(TRIM(message)) > 0)
);

CREATE INDEX idx_chat_messages_doctor_date ON chat_messages (doctor_id, session_date);
CREATE INDEX idx_chat_messages_sent_at     ON chat_messages (sent_at);


-- ---------------------------------------------------------------------------
-- 17. AUDIT_LOGS  (staff actions for operational traceability)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id        UUID,
    patient_id      UUID,
    doctor_id       UUID,
    appointment_id  UUID,
    action          VARCHAR(100) NOT NULL,  -- e.g. 'admit_patient', 'check_in', 'reject_patient'
    metadata        JSONB,
    performed_at    TIMESTAMP   NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_audit_logs_staff       FOREIGN KEY (staff_id)       REFERENCES staff        (id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_logs_patient     FOREIGN KEY (patient_id)     REFERENCES patients     (id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_logs_doctor      FOREIGN KEY (doctor_id)      REFERENCES doctors      (id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_logs_appointment FOREIGN KEY (appointment_id) REFERENCES appointments (id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_logs_staff_id       ON audit_logs (staff_id);
CREATE INDEX idx_audit_logs_appointment_id ON audit_logs (appointment_id);
CREATE INDEX idx_audit_logs_performed_at   ON audit_logs (performed_at);


-- =============================================================================
-- TRIGGERS — auto-update updated_at columns
-- =============================================================================
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_patients_updated_at
    BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_doctors_updated_at
    BEFORE UPDATE ON doctors
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_staff_updated_at
    BEFORE UPDATE ON staff
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_consultation_records_updated_at
    BEFORE UPDATE ON consultation_records
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER trg_queue_entries_updated_at
    BEFORE UPDATE ON queue_entries
    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
