import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

export default function ReportsTab() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get('/admin/reports', { params: { days } });
        if (active) setData(data);
      } catch (err) {
        toast.error(err.displayMessage || 'Could not load reports.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [days]);

  const totalAcrossWindow = (data?.statusBreakdown || []).reduce(
    (sum, r) => sum + Number(r.count || 0),
    0
  );

  return (
    <>
      <div className="admin-header">
        <h1>Reports</h1>
        <div className="row">
          <span className="muted" style={{ fontSize: 13 }}>Range:</span>
          <select
            className="select"
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            style={{ width: 150 }}
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>

      {loading && <div className="empty">Loading…</div>}

      {!loading && data && (
        <>
          {/* Status breakdown */}
          <div className="section-card">
            <div className="section-card-header">
              <h2>Appointment status — last {data.days} days</h2>
              <span className="muted" style={{ fontSize: 12 }}>{totalAcrossWindow} total</span>
            </div>
            <div className="section-card-body">
              {data.statusBreakdown.length === 0 ? (
                <div className="empty">No appointments in this window.</div>
              ) : (
                data.statusBreakdown.map((row) => (
                  <BarRow
                    key={row.status}
                    label={row.status.replace('_', ' ')}
                    value={Number(row.count)}
                    max={totalAcrossWindow}
                  />
                ))
              )}
            </div>
          </div>

          {/* Per day */}
          <div className="section-card">
            <div className="section-card-header">
              <h2>Daily volume</h2>
            </div>
            <div className="section-card-body" style={{ padding: 0 }}>
              {data.perDay.length === 0 ? (
                <div className="empty">No data.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Total</th>
                      <th>Completed</th>
                      <th>Cancelled</th>
                      <th>No-show</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perDay.map((row) => (
                      <tr key={row.date}>
                        <td className="bold">{row.date}</td>
                        <td>{row.total}</td>
                        <td>{row.completed}</td>
                        <td>{row.cancelled}</td>
                        <td>{row.no_show}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Per doctor */}
          <div className="section-card">
            <div className="section-card-header">
              <h2>Doctor workload</h2>
            </div>
            <div className="section-card-body" style={{ padding: 0 }}>
              {data.perDoctor.length === 0 ? (
                <div className="empty">No active doctors.</div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Doctor</th>
                      <th>Specialty</th>
                      <th>Total</th>
                      <th>Completed</th>
                      <th>Cancelled</th>
                      <th>No-show</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perDoctor.map((row) => (
                      <tr key={row.id}>
                        <td className="bold">{row.full_name}</td>
                        <td className="muted">{row.specialty}</td>
                        <td>{row.total}</td>
                        <td>{row.completed}</td>
                        <td>{row.cancelled}</td>
                        <td>{row.no_show}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function BarRow({ label, value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span style={{ textTransform: 'capitalize' }}>{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="bar-value">{value} ({pct}%)</span>
    </div>
  );
}
