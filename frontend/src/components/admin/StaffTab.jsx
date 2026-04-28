import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import Modal from '../Modal.jsx';
import { PasswordResetModal } from './DoctorsTab.jsx';

export default function StaffTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/staff');
      setItems(data.staff);
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load staff.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleActive = async (s) => {
    try {
      await api.patch(`/admin/staff/${s.id}/active`, { isActive: !s.is_active });
      toast.success(s.is_active ? 'Staff deactivated.' : 'Staff reactivated.');
      load();
    } catch (err) {
      toast.error(err.displayMessage || 'Action failed.');
    }
  };

  return (
    <>
      <div className="admin-header">
        <h1>Staff accounts</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
          + Add staff
        </button>
      </div>

      <div className="section-card">
        <div className="section-card-body" style={{ padding: 0 }}>
          {loading && <div className="empty">Loading…</div>}
          {!loading && items.length === 0 && <div className="empty">No staff accounts yet.</div>}
          {!loading && items.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} className={s.is_active ? '' : 'inactive'}>
                    <td className="bold">{s.full_name}</td>
                    <td className="muted">{s.role}</td>
                    <td className="muted">{s.email}</td>
                    <td className="muted">{s.phone || '—'}</td>
                    <td>
                      {s.is_active
                        ? <span className="badge badge-success">Active</span>
                        : <span className="badge badge-muted">Inactive</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-xs" onClick={() => setEditing(s)}>Edit</button>
                        <button className="btn btn-ghost btn-xs" onClick={() => setResetting(s)}>Reset password</button>
                        <button
                          className={`btn btn-xs ${s.is_active ? 'btn-outline' : 'btn-primary'}`}
                          onClick={() => toggleActive(s)}
                        >
                          {s.is_active ? 'Deactivate' : 'Reactivate'}
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

      <StaffModal
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
      <PasswordResetModal
        target={resetting}
        kind="staff"
        onClose={() => setResetting(null)}
        onSaved={() => setResetting(null)}
      />
    </>
  );
}

function StaffModal({ target, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    setForm({
      email: target.email || '',
      password: '',
      phone: target.phone || '',
      fullName: target.full_name || '',
      role: target.role || 'receptionist',
    });
  }, [target?.id, target]);

  if (!target) return null;
  const isEdit = !!target.id;
  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!isEdit && (!form.email || !form.password || !form.fullName)) {
      toast.error('Email, password, and full name are required.');
      return;
    }
    if (isEdit && !form.fullName) { toast.error('Full name is required.'); return; }
    setBusy(true);
    try {
      if (isEdit) {
        await api.put(`/admin/staff/${target.id}`, {
          fullName: form.fullName,
          role: form.role,
          phone: form.phone,
        });
        toast.success('Staff updated.');
      } else {
        await api.post('/admin/staff', {
          email: form.email,
          password: form.password,
          phone: form.phone,
          fullName: form.fullName,
          role: form.role,
        });
        toast.success('Staff created.');
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
      title={isEdit ? `Edit ${target.full_name}` : 'Add a staff account'}
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
          <label className="label">Role</label>
          <select className="select" value={form.role || 'receptionist'} onChange={(e) => upd('role', e.target.value)}>
            <option value="receptionist">Receptionist</option>
            <option value="assistant">Assistant</option>
          </select>
        </div>
        <div>
          <label className="label">Phone (optional)</label>
          <input className="input" value={form.phone || ''} onChange={(e) => upd('phone', e.target.value)} />
        </div>
        {!isEdit ? (
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
        ) : (
          <div className="full">
            <label className="label">Email (read-only)</label>
            <input className="input" value={form.email || ''} disabled />
          </div>
        )}
      </div>
    </Modal>
  );
}
