import { useEffect, useState } from 'react';
import api from '../../api/client';
import { getSocket } from '../../api/socket';
import toast from 'react-hot-toast';

export default function DoctorDashboardTab({ onJump }) {
  const [data, setData] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get('/doctor/dashboard');
      setData(data);
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load dashboard.');
    }
  };

  useEffect(() => {
    load();
    // Refresh on every board update so the doctor's stats reflect the
    // staff-driven queue changes immediately.
    const sock = getSocket();
    const onUpdate = () => load();
    sock?.on?.('board:update', onUpdate);
    const id = setInterval(load, 30 * 1000);
    return () => {
      clearInterval(id);
      sock?.off?.('board:update', onUpdate);
    };
  }, []);

  const stats = data?.stats || {};

  return (
    <>
      <div className="doctor-header">
        <h1>Today</h1>
        <span className="muted" style={{ fontSize: 13 }}>{data?.today || ''}</span>
      </div>

      {/* Next patient hero */}
      {data?.next ? (
        <div className="next-card">
          <div className="label">Next patient</div>
          <div className="name">{data.next.patient_name}</div>
          <div className="when">
            Scheduled at {data.next.scheduled_start_time?.slice(0, 5)}
            {' · '}
            {labelForKanban(data.next.kanban_status)}
          </div>
          <button
            className="btn"
            style={{ marginTop: 14, background: 'white', color: 'var(--text)' }}
            onClick={() => onJump?.('queue')}
          >
            Open today's queue →
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 20, marginBottom: 22 }}>
          <div className="muted" style={{ fontSize: 14 }}>
            No upcoming patients today. You're all caught up.
          </div>
        </div>
      )}

      {/* Stat tiles */}
      <div className="stat-grid">
        <Stat label="Total today"      value={stats.total_today || 0} />
        <Stat label="Completed"        value={stats.completed   || 0} accent="var(--success)" />
        <Stat label="In consultation"  value={stats.in_consult  || 0} accent="var(--primary)" />
        <Stat label="Waiting"          value={stats.waiting     || 0} accent="var(--warning)" />
      </div>
    </>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value" style={{ color: accent || 'var(--text)' }}>{value}</div>
    </div>
  );
}

function labelForKanban(s) {
  return ({
    upcoming:        'awaiting check-in',
    waiting:         'in waiting room',
    in_consultation: 'in consultation',
    completed:       'completed',
  })[s] || s;
}
