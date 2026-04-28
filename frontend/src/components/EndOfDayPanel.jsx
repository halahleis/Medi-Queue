import { useEffect, useState } from 'react';
import api from '../api/client';
import Modal from './Modal.jsx';

export default function EndOfDayPanel({ open, onClose, date }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get('/staff/end-of-day', { params: { date } });
        setSummary(data.summary);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [open, date]);

  const Stat = ({ label, value, accent }) => (
    <div
      className="card"
      style={{ padding: 16, textAlign: 'center', flex: 1, minWidth: 130 }}
    >
      <div
        className="bold"
        style={{
          fontSize: 28,
          color: accent || 'var(--text)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{label}</div>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title={`Clinic summary — ${date}`} width={560}>
      {loading && <div className="empty">Loading…</div>}
      {!loading && summary && (
        <div className="col">
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <Stat label="Total appointments" value={summary.total || 0} />
            <Stat label="Completed" value={summary.completed || 0} accent="var(--success)" />
            <Stat label="Late arrivals" value={summary.late || 0} accent="var(--danger)" />
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <Stat label="No-shows" value={summary.no_show || 0} accent="var(--warning)" />
            <Stat label="Rejected" value={summary.rejected || 0} accent="var(--danger)" />
            <Stat
              label="Avg. wait (min)"
              value={
                summary.avg_wait_minutes != null
                  ? Math.round(Number(summary.avg_wait_minutes))
                  : '—'
              }
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
