import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import Modal from '../Modal.jsx';

export default function DoctorsTab() {
  const [items, setItems] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docs, deps] = await Promise.all([
        api.get('/admin/doctors'),
        api.get('/admin/departments'),
      ]);
      setItems(docs.data.doctors);
      setDepartments(deps.data.departments.filter((d) => d.is_active));
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load doctors.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleActive = async (doc) => {
    try {
      await api.patch(`/admin/doctors/${doc.id}/active`, { isActive: !doc.is_active });
      toast.success(doc.is_active ? 'Doctor deactivated.' : 'Doctor reactivated.');
      load();
    } catch (err) {
      toast.error(err.displayMessage || 'Action failed.');
    }
  };

  const filtered = items.filter((d) => {
    if (!filter.trim()) return true;
    const t = filter.trim().toLowerCase();
    return (
      d.full_name.toLowerCase().includes(t) ||
      (d.specialty || '').toLowerCase().includes(t) ||
      (d.department_name || '').toLowerCase().includes(t) ||
      (d.email || '').toLowerCase().includes(t)
    );
  });

  return (
    <>
      <div className="admin-header">
        <h1>Doctors</h1>
        <div className="row" style={{ gap: 10 }}>
          <input
            className="input"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 200 }}
          />
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
            + Add doctor
          </button>
        </div>
      </div>

      <div className="section-card">
        <div className="section-card-body" style={{ padding: 0 }}>
          {loading && <div className="empty">Loading…</div>}
          {!loading && filtered.length === 0 && <div className="empty">No doctors found.</div>}
          {!loading && filtered.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Specialty</th>
                  <th>Department</th>
                  <th>Email</th>
                  <th>Fee</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.id} className={d.is_active ? '' : 'inactive'}>
                    <td className="bold">{d.full_name}</td>
                    <td>{d.specialty}</td>
                    <td>{d.department_name || <span className="muted">— unassigned —</span>}</td>
                    <td className="muted">{d.email}</td>
                    <td>${d.standard_fee}</td>
                    <td>
                      {d.is_active
                        ? <span className="badge badge-success">Active</span>
                        : <span className="badge badge-muted">Inactive</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-xs" onClick={() => setEditing(d)}>Edit</button>
                        <button className="btn btn-ghost btn-xs" onClick={() => setResetting(d)}>Reset password</button>
                        <button
                          className={`btn btn-xs ${d.is_active ? 'btn-outline' : 'btn-primary'}`}
                          onClick={() => toggleActive(d)}
                        >
                          {d.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <DoctorModal
        target={editing}
        departments={departments}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
      <PasswordResetModal
        target={resetting}
        kind="doctors"
        onClose={() => setResetting(null)}
        onSaved={() => setResetting(null)}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
function DoctorModal({ target, departments, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setForm({
      email: target.email || '',
      password: '',
      phone: target.phone || '',
      fullName: target.full_name || '',
      specialty: target.specialty || '',
      qualifications: target.qualifications || '',
      biography: target.biography || '',
      departmentId: target.department_id || '',
      standardFee: target.standard_fee ?? 0,
      followupFee: target.followup_fee ?? 0,
      appointmentDurationMinutes: target.appointment_duration_minutes ?? 20,
    });
  }, [target?.id, target]);

  if (!target) return null;
  const isEdit = !!target.id;
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!isEdit) {
      if (!form.email || !form.password || !form.fullName || !form.specialty) {
        toast.error('Email, password, full name, and specialty are required.');
        return;
      }
    } else {
      if (!form.fullName || !form.specialty) {
        toast.error('Full name and specialty are required.');
        return;
      }
    }
    setBusy(true);
    try {
      if (isEdit) {
        await api.put(`/admin/doctors/${target.id}`, {
          fullName: form.fullName,
          specialty: form.specialty,
          qualifications: form.qualifications,
          biography: form.biography,
          departmentId: form.departmentId || null,
          standardFee: Number(form.standardFee),
          followupFee: Number(form.followupFee),
          appointmentDurationMinutes: Number(form.appointmentDurationMinutes),
          phone: form.phone,
        });
        toast.success('Doctor updated.');
      } else {
        await api.post('/admin/doctors', {
          email: form.email,
          password: form.password,
          phone: form.phone,
          fullName: form.fullName,
          specialty: form.specialty,
          qualifications: form.qualifications,
          biography: form.biography,
          departmentId: form.departmentId || null,
          standardFee: Number(form.standardFee),
          followupFee: Number(form.followupFee),
          appointmentDurationMinutes: Number(form.appointmentDurationMinutes),
        });
        toast.success('Doctor created.');
      }
      onSaved();
    } catch (err) {
      toast.error(err.displayMessage || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${target.full_name}` : 'Add a doctor'}
      width={620}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="full">
          <label className="label">Full name</label>
          <input className="input" value={form.fullName || ''} onChange={(e) => upd('fullName', e.target.value)} />
        </div>
        <div>
          <label className="label">Specialty</label>
          <input className="input" value={form.specialty || ''} onChange={(e) => upd('specialty', e.target.value)} />
        </div>
        <div>
          <label className="label">Department</label>
          <select className="select" value={form.departmentId || ''} onChange={(e) => upd('departmentId', e.target.value)}>
            <option value="">— Unassigned —</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        {!isEdit && (
          <>
            <div>
              <label className="label">Email (login)</label>
              <input className="input" type="email" value={form.email || ''} onChange={(e) => upd('email', e.target.value)} />
            </div>
            <div>
              <label className="label">Initial password</label>
              <input className="input" type="password" value={form.password || ''} onChange={(e) => upd('password', e.target.value)} />
            </div>
          </>
        )}
        {isEdit && (
          <div className="full">
            <label className="label">Email (read-only)</label>
            <input className="input" value={form.email || ''} disabled />
          </div>
        )}
        <div>
          <label className="label">Phone (optional)</label>
          <input className="input" value={form.phone || ''} onChange={(e) => upd('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">Qualifications</label>
          <input className="input" value={form.qualifications || ''} onChange={(e) => upd('qualifications', e.target.value)} placeholder="e.g. MD, FACC" />
        </div>
        <div>
          <label className="label">Standard fee ($)</label>
          <input className="input" type="number" value={form.standardFee ?? 0} onChange={(e) => upd('standardFee', e.target.value)} />
        </div>
        <div>
          <label className="label">Follow-up fee ($)</label>
          <input className="input" type="number" value={form.followupFee ?? 0} onChange={(e) => upd('followupFee', e.target.value)} />
        </div>
        <div>
          <label className="label">Appointment duration (min)</label>
          <input className="input" type="number" value={form.appointmentDurationMinutes ?? 20} onChange={(e) => upd('appointmentDurationMinutes', e.target.value)} />
        </div>
        <div className="full">
          <label className="label">Biography</label>
          <textarea
            className="input"
            rows={3}
            value={form.biography || ''}
            onChange={(e) => upd('biography', e.target.value)}
          />
        </div>
        <div className="full muted" style={{ fontSize: 12 }}>
          The doctor can edit their own schedule, fees, and biography after logging in.
          Department assignment and account status remain admin-controlled.
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
export function PasswordResetModal({ target, kind, onClose, onSaved }) {
  const [pwd, setPwd] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (target) setPwd(''); }, [target?.id]);
  if (!target) return null;

  const save = async () => {
    if (!pwd || pwd.length < 6) { toast.error('Password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      await api.post(`/admin/${kind}/${target.id}/password`, { newPassword: pwd });
      toast.success('Password reset.');
      onSaved();
    } catch (err) {
      toast.error(err.displayMessage || 'Reset failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password — ${target.full_name}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Reset password'}
          </button>
        </>
      }
    >
      <div>
        <label className="label">New password</label>
        <input className="input" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          The user will use this password the next time they sign in.
        </div>
      </div>
    </Modal>
  );
}
