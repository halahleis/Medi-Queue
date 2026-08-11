import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { fmtTime } from '../utils/time';
import toast from 'react-hot-toast';

export default function UpdateTimesModal({ entry, onClose, onSave }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (entry) {
      const admitted = entry.kanban_status === 'in_consultation';
      setStart(fmtTime(admitted ? entry.actual_start_time : entry.scheduled_start_time));
      setEnd(fmtTime(admitted ? currentTimeValue() : entry.scheduled_end_time));
    }
  }, [entry]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(start + ':00', end + ':00');
      toast.success('Times updated. Subsequent appointments shifted to avoid overlap.');
    } catch (err) {
      toast.error(err.displayMessage || 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  if (!entry) return null;

  const startLocked = entry.kanban_status === 'in_consultation';
  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      title={`Update times — ${entry.patient_name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <div>
          <label className="label">Start time {startLocked && <span className="muted">(locked — patient already admitted)</span>}</label>
          <input
            className="input"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={startLocked}
          />
        </div>
        <div>
          <label className="label">End time</label>
          <input
            className="input"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          If your new times overlap a later appointment, the system will shift it (and any
          following ones) down automatically.
        </div>
      </div>
    </Modal>
  );
}

function currentTimeValue() {
  const d = new Date();
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join(':');
}
