import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import Modal from '../Modal.jsx';

export default function DepartmentsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // { id?, name, description }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/departments');
      setItems(data.departments);
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load departments.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleActive = async (dept) => {
    try {
      await api.patch(`/admin/departments/${dept.id}/active`, { isActive: !dept.is_active });
      toast.success(dept.is_active ? 'Department deactivated.' : 'Department reactivated.');
      load();
    } catch (err) {
      toast.error(err.displayMessage || 'Action failed.');
    }
  };

  return (
    <>
      <div className="admin-header">
        <h1>Departments</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: '', description: '' })}>
          + Add department
        </button>
      </div>

      <div className="section-card">
        <div className="section-card-body" style={{ padding: 0 }}>
          {loading && <div className="empty">Loading…</div>}
          {!loading && items.length === 0 && <div className="empty">No departments yet.</div>}
          {!loading && items.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Doctors</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} className={d.is_active ? '' : 'inactive'}>
                    <td className="bold">{d.name}</td>
                    <td className="muted">{d.description || '—'}</td>
                    <td>{d.doctor_count || 0}</td>
                    <td>
                      {d.is_active
                        ? <span className="badge badge-success">Active</span>
                        : <span className="badge badge-muted">Inactive</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-xs" onClick={() => setEditing(d)}>Edit</button>
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

      <DepartmentModal
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    </>
  );
}

function DepartmentModal({ target, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setName(target.name || '');
      setDescription(target.description || '');
    }
  }, [target?.id, target]);

  if (!target) return null;
  const isEdit = !!target.id;

  const save = async () => {
    if (!name.trim()) { toast.error('Name is required.'); return; }
    setBusy(true);
    try {
      if (isEdit) {
        await api.put(`/admin/departments/${target.id}`, { name: name.trim(), description });
        toast.success('Department updated.');
      } else {
        await api.post('/admin/departments', { name: name.trim(), description });
        toast.success('Department created.');
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
      title={isEdit ? `Edit ${target.name}` : 'Add a department'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="col">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Description (optional)</label>
          <textarea
            className="input"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
