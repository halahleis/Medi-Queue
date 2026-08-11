CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS patient_staff_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
    assigned_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    subject TEXT NOT NULL DEFAULT 'General question',
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'pending_patient', 'resolved')),
    last_message_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patient_staff_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES patient_staff_conversations(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL CHECK (char_length(trim(message)) BETWEEN 1 AND 2000),
    sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
    read_by_patient_at TIMESTAMP,
    read_by_staff_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patient_staff_conversations_patient
  ON patient_staff_conversations(patient_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_staff_conversations_status
  ON patient_staff_conversations(status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_patient_staff_messages_conversation
  ON patient_staff_messages(conversation_id, sent_at ASC);
