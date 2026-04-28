import { useEffect, useState } from 'react';
import api from '../api/client';
import Modal from './Modal.jsx';
import { fmtTime } from '../utils/time';

export default function SearchPanel({ open, onClose }) {
  const [q, setQ] = useState('');
  const [date, setDate] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const { data } = await api.get('/staff/search', {
          params: { q: q.trim(), date: date || undefined },
        });
        setResults(data.results || []);
      } catch (err) {
        console.error(err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [q, date, open]);

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setQ('');
      setDate('');
      setResults([]);
    }
  }, [open]);

  const statusBadge = (kanban) => {
    if (!kanban) return <span className="badge badge-muted">No queue entry</span>;
    const map = {
      upcoming:        ['badge-muted',   'Upcoming'],
      waiting:         ['badge-info',    'Waiting'],
      in_consultation: ['badge-success', 'In Consult.'],
      completed:       ['badge-muted',   'Completed'],
      rejected:        ['badge-danger',  'Rejected'],
      no_show:         ['badge-warning', 'No-show'],
    };
    const [cls, label] = map[kanban] || ['badge-muted', kanban];
    return <span className={`badge ${cls}`}>{label}</span>;
  };

  return (
    <Modal open={open} onClose={onClose} title="Search patients & appointments" width={620}>
      <div className="col">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="label">Name, phone or appointment ID</label>
            <input
              className="input"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. Chen, +961…, appointment id"
            />
          </div>
          <div>
            <label className="label">Date (optional)</label>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <div style={{ marginTop: 12, maxHeight: 380, overflowY: 'auto' }}>
          {loading && <div className="empty">Searching…</div>}
          {!loading && q.trim().length < 2 && (
            <div className="empty">Type at least 2 characters to search.</div>
          )}
          {!loading && q.trim().length >= 2 && results.length === 0 && (
            <div className="empty">No results found.</div>
          )}
          {results.map((r) => (
            <div key={r.appointment_id} className="card" style={{ padding: 12, marginBottom: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="bold">{r.patient_name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {r.patient_phone || '—'} · with {r.doctor_name}
                  </div>
                </div>
                {statusBadge(r.kanban_status)}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {r.appointment_date} · {fmtTime(r.appointment_time)}
                {r.arrived_at && (
                  <> · Arrived {new Date(r.arrived_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          Reception view — only operational data is shown. Medical records are not accessible here.
        </div>
      </div>
    </Modal>
  );
}
