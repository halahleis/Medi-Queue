import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import Modal from '../Modal.jsx';

const DAYS = [
  { key: 'monday',    label: 'Monday' },
  { key: 'tuesday',   label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday',  label: 'Thursday' },
  { key: 'friday',    label: 'Friday' },
  { key: 'saturday',  label: 'Saturday' },
  { key: 'sunday',    label: 'Sunday' },
];

export default function DoctorScheduleTab() {
  const [weekly, setWeekly] = useState({});       // { day_of_week: { start, end, active } }
  const [unavailabilities, setUnavailabilities] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showOff, setShowOff] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/doctor/schedule');
      const w = {};
      for (const day of DAYS) {
        const row = data.weekly.find((r) => r.day_of_week === day.key);
        w[day.key] = row
          ? { start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5), active: !!row.is_active, hasRow: true }
          : { start: '09:00', end: '17:00', active: false, hasRow: false };
      }
      setWeekly(w);
      setUnavailabilities(data.unavailabilities);
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load schedule.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upd = (day, k, v) => setWeekly((w) => ({ ...w, [day]: { ...w[day], [k]: v } }));

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        weekly: DAYS
          .map((d) => weekly[d.key])
          .map((row, i) => ({
            day_of_week: DAYS[i].key,
            start_time: row.start,
            end_time: row.end,
            is_active: row.active,
          }))
          .filter((row) => row.active || weekly[row.day_of_week].hasRow),
        // We send only the active days OR previously-existing rows. The
        // backend deletes everything first then re-inserts what we send.
      };
      // Filter to only active rows actually — inactive days simply have no row.
      payload.weekly = payload.weekly.filter((r) => r.is_active);
      await api.put('/doctor/schedule', payload);
      toast.success('Schedule saved.');
      load();
    } catch (err) {
      toast.error(err.displayMessage || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const deleteUnav = async (id) => {
    try {
      await api.delete(`/doctor/unavailabilities/${id}`);
      toast.success('Removed.');
      load();
    } catch (err) {
      toast.error(err.displayMessage || 'Could not remove.');
    }
  };

  return (
    <>
      <div className="doctor-header">
        <h1>Schedule</h1>
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save schedule'}
        </button>
      </div>

      <div className="card" style={{ padding: '8px 18px', marginBottom: 24 }}>
        {DAYS.map((d) => {
          const row = weekly[d.key] || {};
          return (
            <div key={d.key} className="sched-row">
              <div className="day">{d.label}</div>
              <input
                type="time"
                className="input"
                value={row.start || '09:00'}
                disabled={!row.active}
                onChange={(e) => upd(d.key, 'start', e.target.value)}
              />
              <input
                type="time"
                className="input"
                value={row.end || '17:00'}
                disabled={!row.active}
                onChange={(e) => upd(d.key, 'end', e.target.value)}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!row.active}
                  onChange={(e) => upd(d.key, 'active', e.target.checked)}
                />
                Working
              </label>
            </div>
          );
        })}
      </div>

      <div className="doctor-header">
        <h1 style={{ fontSize: 18 }}>Days off & blocked times</h1>
        <button className="btn btn-outline btn-sm" onClick={() => setShowOff(true)}>+ Add day off</button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {unavailabilities.length === 0 && (
          <div className="empty">No upcoming days off.</div>
        )}
        {unavailabilities.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Time</th>
                <th>Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unavailabilities.map((u) => (
                <tr key={u.id}>
                  <td>{u.unavailable_date}</td>
                  <td>{u.is_full_day ? 'Full day' : 'Partial block'}</td>
                  <td className="muted">
                    {u.is_full_day
                      ? '—'
                      : `${u.block_start_time?.slice(0, 5)} – ${u.block_end_time?.slice(0, 5)}`}
                  </td>
                  <td className="muted">{u.reason || '—'}</td>
                  <td><div className="row-actions">
                    <button className="btn btn-ghost btn-xs" onClick={() => deleteUnav(u.id)}>Remove</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showOff && (
        <UnavailabilityModal
          onClose={() => setShowOff(false)}
          onSaved={() => { setShowOff(false); load(); }}
        />
      )}
    </>
  );
}

function UnavailabilityModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ date: '', isFullDay: true, startTime: '', endTime: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.date) { toast.error('Date is required.'); return; }
    if (!form.isFullDay && (!form.startTime || !form.endTime)) {
      toast.error('Start and end times are required for partial blocks.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/doctor/unavailabilities', form);
      toast.success('Added.');
      onSaved();
    } catch (err) {
      toast.error(err.displayMessage || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open onClose={onClose}
      title="Add a day off or blocked time"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Add'}
          </button>
        </>
      }
    >
      <div className="col">
        <div>
          <label className="label">Date</label>
          <input type="date" className="input" value={form.date} onChange={(e) => upd('date', e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={form.isFullDay}
            onChange={(e) => upd('isFullDay', e.target.checked)}
          />
          Full day off
        </label>
        {!form.isFullDay && (
          <div className="row" style={{ gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Start</label>
              <input type="time" className="input" value={form.startTime} onChange={(e) => upd('startTime', e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">End</label>
              <input type="time" className="input" value={form.endTime} onChange={(e) => upd('endTime', e.target.value)} />
            </div>
          </div>
        )}
        <div>
          <label className="label">Reason (optional)</label>
          <input className="input" value={form.reason} onChange={(e) => upd('reason', e.target.value)} placeholder="e.g. conference, surgery" />
        </div>
      </div>
    </Modal>
  );
}
