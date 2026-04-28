import { useEffect, useState } from 'react';
import api from '../../api/client';
import toast from 'react-hot-toast';

export default function OverviewTab({ onJump }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await api.get('/admin/overview');
        if (active) setData(data);
      } catch (err) {
        toast.error(err.displayMessage || 'Could not load overview.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const stats = data?.stats || {};

  const StatCard = ({ label, value, delta, onClick }) => (
    <button
      className="stat-card"
      onClick={onClick}
      style={{
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        border: '1px solid var(--border-soft)',
        font: 'inherit',
      }}
    >
      <div className="label">{label}</div>
      <div className="value">{loading ? '—' : (value ?? 0)}</div>
      {delta && <div className="delta">{delta}</div>}
    </button>
  );

  return (
    <>
      <div className="admin-header">
        <h1>Overview</h1>
        <span className="muted">{data?.today || ''}</span>
      </div>

      <div className="stat-grid">
        <StatCard label="Active doctors"    value={stats.active_doctors}    onClick={() => onJump?.('doctors')} />
        <StatCard label="Active departments" value={stats.active_departments} onClick={() => onJump?.('departments')} />
        <StatCard label="Active staff"      value={stats.active_staff}      onClick={() => onJump?.('staff')} />
        <StatCard label="Total patients"    value={stats.total_patients} />
      </div>

      <div className="stat-grid">
        <StatCard label="Today's appointments" value={stats.appointments_today} />
        <StatCard
          label="Completed today"
          value={stats.completed_today}
          delta={
            stats.appointments_today > 0
              ? `${Math.round((stats.completed_today / stats.appointments_today) * 100)}% of today`
              : null
          }
        />
        <StatCard label="Cancellations today" value={stats.cancellations_today} />
        <StatCard
          label="Inactive doctors"
          value={stats.inactive_doctors}
          delta="Soft-deleted accounts"
        />
      </div>

      <div className="section-card">
        <div className="section-card-header">
          <h2>Quick actions</h2>
        </div>
        <div className="section-card-body">
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={() => onJump?.('departments')}>
              Manage departments
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => onJump?.('doctors')}>
              Manage doctors
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => onJump?.('staff')}>
              Manage staff
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => onJump?.('reports')}>
              View reports
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
