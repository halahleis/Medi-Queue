import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../api/client';
import Modal from './Modal.jsx';
import { fmtTime, nowTimeStr, timeToMin, minToTime, LATE_GRACE_MIN } from '../utils/time';

const COLUMNS = [
  { key: 'upcoming',        label: 'Upcoming' },
  { key: 'waiting',         label: 'Waiting Room' },
  { key: 'in_consultation', label: 'In Consultation' },
  { key: 'completed',       label: 'Completed' },
];

const TRAYS = [
  { key: 'rejected', label: 'Rejected' },
  { key: 'no_show',  label: 'No-Show' },
];

export default function KanbanBoard({ entries, onChange }) {
  const [admitTarget, setAdmitTarget] = useState(null);
  const [completeTarget, setCompleteTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [actionTarget, setActionTarget] = useState(null);

  // Tick once a minute so the "X min late" label on upcoming cards stays fresh.
  const [nowMin, setNowMin] = useState(timeToMin(nowTimeStr()));
  useEffect(() => {
    const id = setInterval(() => setNowMin(timeToMin(nowTimeStr())), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const grouped = (status) => entries.filter((e) => e.kanban_status === status);

  const call = async (path, body, successMsg) => {
    try {
      await api.post(path, body || {});
      successMsg && toast.success(successMsg);
      onChange?.();
    } catch (err) {
      toast.error(err.displayMessage || 'Action failed.');
    }
  };

  const handleCheckIn = (id) =>
    call(`/staff/entries/${id}/check-in`, null, 'Patient checked in.');
  const handleAddToLive = (id) =>
    call(`/staff/entries/${id}/add-to-live`, null, 'Added to live schedule.');
  const handleNoShow = (id) =>
    call(`/staff/entries/${id}/no-show`, null, 'Marked no-show.');

  return (
    <>
      <div className="kanban">
        {COLUMNS.map((col) => {
          const items = grouped(col.key);
          return (
            <section key={col.key} className="kanban-col">
              <h4>
                <span>{col.label}</span>
                <span className="count">{items.length}</span>
              </h4>
              {items.length === 0 && <div className="empty">Nothing here.</div>}
              {items.map((e) => (
                <KCard
                  key={e.id}
                  entry={e}
                  nowMin={nowMin}
                  onCheckIn={handleCheckIn}
                  onAddToLive={handleAddToLive}
                  onAdmit={() => setAdmitTarget(e)}
                  onComplete={() => setCompleteTarget(e)}
                  onReject={() => setRejectTarget(e)}
                  onAction={() => setActionTarget(e)}
                  onNoShow={handleNoShow}
                />
              ))}
            </section>
          );
        })}

        {/* Trays for terminal states */}
        <div className="trays">
          {TRAYS.map((t) => {
            const items = grouped(t.key);
            return (
              <section key={t.key} className="kanban-col">
                <h4>
                  <span>{t.label}</span>
                  <span className="count">{items.length}</span>
                </h4>
                {items.length === 0 && <div className="empty">None.</div>}
                {items.map((e) => (
                  <div key={e.id} className={`k-card ${t.key}`}>
                    <div className="k-row1">
                      <span className="k-name">{e.patient_name}</span>
                      <span className="k-time">{fmtTime(e.scheduled_start_time)}</span>
                    </div>
                    {e.rejection_reason && (
                      <div className="k-meta">Reason: {e.rejection_reason}</div>
                    )}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </div>

      {/* Admit confirm modal */}
      <AdmitModal
        entry={admitTarget}
        onClose={() => setAdmitTarget(null)}
        onConfirm={async (startTime) => {
          await call(`/staff/entries/${admitTarget.id}/admit`, { startTime }, 'Patient admitted.');
          setAdmitTarget(null);
        }}
      />

      {/* Complete modal */}
      <CompleteModal
        entry={completeTarget}
        onClose={() => setCompleteTarget(null)}
        onConfirm={async (endTime, notes) => {
          await call(`/staff/entries/${completeTarget.id}/complete`, { endTime, notes }, 'Visit completed.');
          setCompleteTarget(null);
        }}
      />

      {/* Reject modal */}
      <RejectModal
        entry={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={async (reason) => {
          await call(`/staff/entries/${rejectTarget.id}/reject`, { reason }, 'Patient rejected.');
          setRejectTarget(null);
        }}
      />

      {/* Action Required modal */}
      <ActionRequiredModal
        entry={actionTarget}
        onClose={() => setActionTarget(null)}
        onConfirm={async (reason) => {
          await call(`/staff/entries/${actionTarget.id}/action-required`, { reason }, 'Notification sent.');
          setActionTarget(null);
        }}
      />
    </>
  );
}

/* -------------------------------- Card -------------------------------- */
function KCard({
  entry: e,
  nowMin,
  onCheckIn,
  onAddToLive,
  onAdmit,
  onComplete,
  onReject,
  onAction,
  onNoShow,
}) {
  const inLive = e.position != null;

  // The "scheduled" time we display on the card is the EXPECTED start time
  // given the patient's actual position in the queue, not the original
  // booked time. For upcoming/waiting cards this is `max(scheduled, now)`,
  // which automatically reflects any delays applied to the queue.
  const expectedStartMin = (() => {
    if (e.actual_start_time) return timeToMin(e.actual_start_time);
    if (e.kanban_status === 'completed') {
      return timeToMin(e.actual_start_time || e.scheduled_start_time);
    }
    const sched = timeToMin(e.scheduled_start_time);
    return Math.max(sched, nowMin ?? 0);
  })();
  const expectedStart = minToTime(expectedStartMin);

  // Lateness is computed from the ORIGINAL booked slot time so it stays
  // stable regardless of delays applied later. `original_scheduled_start`
  // comes from the appointment's slot row and is never mutated.
  const originalScheduled =
    e.original_scheduled_start || e.scheduled_start_time;

  let lateMinutes = null;
  if (e.kanban_status === 'upcoming' && nowMin != null) {
    const sched = timeToMin(originalScheduled);
    const diff = nowMin - sched;
    if (diff > LATE_GRACE_MIN) lateMinutes = diff;
  } else if (e.kanban_status === 'waiting' && e.arrival_tag === 'late' && e.arrived_at) {
    const arrived = new Date(e.arrived_at);
    const arrivedMin = arrived.getHours() * 60 + arrived.getMinutes();
    const sched = timeToMin(originalScheduled);
    lateMinutes = Math.max(0, arrivedMin - sched);
  }

  return (
    <div className={`k-card ${e.kanban_status} ${lateMinutes != null ? 'late-tag' : ''}`}>
      <div className="k-row1">
        <span className="k-name">{e.patient_name}</span>
        <span className="k-time">{fmtTime(expectedStart)}</span>
      </div>
      <div className="k-meta">
        {lateMinutes != null && (
          <span className="arrival-tag late">⚠ {lateMinutes} min late</span>
        )}
        {e.arrival_tag && e.arrival_tag !== 'late' && (
          <span className={`arrival-tag ${e.arrival_tag}`}>{e.arrival_tag.replace('_', ' ')}</span>
        )}
        {e.arrived_at && (
          <span style={{ marginLeft: 8 }}>
            Arrived {new Date(e.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {e.actual_start_time && (
          <span style={{ marginLeft: 8 }}>Started {fmtTime(e.actual_start_time)}</span>
        )}
        {inLive && e.kanban_status === 'waiting' && (
          <span className="badge badge-info" style={{ marginLeft: 8 }}>On live #{e.position}</span>
        )}
      </div>

      <div className="k-actions">
        {e.kanban_status === 'upcoming' && (
          <>
            <button className="btn btn-outline btn-xs" onClick={() => onCheckIn(e.id)}>Check-in</button>
            <button className="btn btn-ghost btn-xs" onClick={() => onNoShow(e.id)}>No-show</button>
          </>
        )}
        {e.kanban_status === 'waiting' && (
          <>
            {!inLive && (
              <button className="btn btn-primary btn-xs" onClick={() => onAddToLive(e.id)}>
                Add to Live Schedule
              </button>
            )}
            {inLive && (
              <button className="btn btn-primary btn-xs" onClick={onAdmit}>Admit</button>
            )}
            <button className="btn btn-outline btn-xs" onClick={onAction}>Action Required</button>
            <button className="btn btn-outline btn-xs" onClick={onReject}>Reject</button>
          </>
        )}
        {e.kanban_status === 'in_consultation' && (
          <button className="btn btn-primary btn-xs" onClick={onComplete}>
            Complete Visit
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- Sub-modals -------------------------------- */
function AdmitModal({ entry, onClose, onConfirm }) {
  const [start, setStart] = useState('');
  const [room, setRoom] = useState('4');
  const [busy, setBusy] = useState(false);

  // Initialize start time when the modal opens for a new entry.
  useEffect(() => {
    if (entry) setStart(nowTimeStr().slice(0, 5));
  }, [entry?.id]);

  if (!entry) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Admit ${entry.patient_name}?`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(start + ':00', room); } finally { setBusy(false); }
            }}
          >
            {busy ? 'Admitting…' : `Admit to Room ${room}`}
          </button>
        </>
      }
    >
      <div className="col">
        <div>
          <label className="label">Actual start time</label>
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="label">Room</label>
          <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Once admitted, the start time will lock as the official record.
        </div>
      </div>
    </Modal>
  );
}

function CompleteModal({ entry, onClose, onConfirm }) {
  const [end, setEnd] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entry) {
      setEnd(nowTimeStr().slice(0, 5));
      setNotes('');
    }
  }, [entry?.id]);

  if (!entry) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Complete visit — ${entry.patient_name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(end + ':00', notes); } finally { setBusy(false); }
            }}
          >
            {busy ? 'Completing…' : 'Complete Visit'}
          </button>
        </>
      }
    >
      <div className="col">
        <div>
          <label className="label">End time</label>
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div>
          <label className="label">Brief visit notes / follow-up date (optional)</label>
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional summary or next-step note"
          />
        </div>
      </div>
    </Modal>
  );
}

function RejectModal({ entry, onClose, onConfirm }) {
  const [reason, setReason] = useState('clinic_full');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  if (!entry) return null;

  const reasonText = () => {
    switch (reason) {
      case 'clinic_full':       return 'Clinic is at capacity for today.';
      case 'doctor_unavailable':return 'Doctor unavailable.';
      case 'patient_too_late':  return 'Patient arrived too late to be seen today.';
      case 'other':             return custom.trim() || 'Other';
      default:                  return reason;
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reject — ${entry.patient_name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-danger"
            disabled={busy || (reason === 'other' && !custom.trim())}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(reasonText()); } finally { setBusy(false); }
            }}
          >
            Reject
          </button>
        </>
      }
    >
      <div className="col">
        <div>
          <label className="label">Reason</label>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="clinic_full">Clinic at capacity</option>
            <option value="doctor_unavailable">Doctor unavailable</option>
            <option value="patient_too_late">Patient too late</option>
            <option value="other">Other</option>
          </select>
        </div>
        {reason === 'other' && (
          <textarea
            className="input"
            rows={3}
            placeholder="Please specify the reason"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}
        <div className="muted" style={{ fontSize: 12 }}>
          The patient will receive a push notification with this reason.
        </div>
      </div>
    </Modal>
  );
}

function ActionRequiredModal({ entry, onClose, onConfirm }) {
  const [reason, setReason] = useState('too_late');
  const [busy, setBusy] = useState(false);
  if (!entry) return null;

  const labels = {
    too_late:              'Patient is too late',
    too_early:             'Patient is too early',
    schedule_disturbance:  'Hospital schedule disturbance',
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Send notification — ${entry.patient_name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(reason); } finally { setBusy(false); }
            }}
          >
            Send notification
          </button>
        </>
      }
    >
      <div className="col">
        <div>
          <label className="label">Reason for notification</label>
          <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(labels).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          A pre-written message will be sent to the patient asking them to speak to reception.
        </div>
      </div>
    </Modal>
  );
}
