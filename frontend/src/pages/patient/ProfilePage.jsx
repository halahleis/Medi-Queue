import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

const BLOOD_TYPES = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function ProfilePage() {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get('/patient/profile');
      setForm({
        fullName: data.profile.full_name || '',
        email: data.profile.email || '',
        phone: data.profile.phone || '',
        bloodType: data.profile.blood_type || '',
        allergies: data.profile.allergies || '',
        chronicConditions: data.profile.chronic_conditions || '',
        currentMedications: data.profile.current_medications || '',
        insuranceProvider: data.profile.insurance_provider || '',
        insuranceNumber: data.profile.insurance_number || '',
        emergencyContactName: data.profile.emergency_contact_name || '',
        emergencyContactPhone: data.profile.emergency_contact_phone || '',
      });
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load profile.');
    }
  };

  useEffect(() => { load(); }, []);

  if (!form) return <div className="patient-page"><div className="empty">Loading…</div></div>;

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onSave = async () => {
    setBusy(true);
    try {
      await api.put('/patient/profile', form);
      toast.success('Profile updated.');
      setEditing(false);
      load();
    } catch (err) {
      toast.error(err.displayMessage || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const Field = ({ label, k, type = 'text', readOnly = false, textarea = false }) => (
    <div>
      <label className="label">{label}</label>
      {textarea ? (
        <textarea
          className="input"
          rows={2}
          value={form[k] || ''}
          onChange={(e) => upd(k, e.target.value)}
          disabled={!editing || readOnly}
        />
      ) : (
        <input
          className="input"
          type={type}
          value={form[k] || ''}
          onChange={(e) => upd(k, e.target.value)}
          disabled={!editing || readOnly}
        />
      )}
    </div>
  );

  return (
    <div className="patient-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>My Profile</h2>
        {!editing ? (
          <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>Edit</button>
        ) : (
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); load(); }}>Cancel</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={onSave}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 14px' }}>
          Contact information
        </h3>
        <div className="profile-grid">
          <Field label="Full name" k="fullName" />
          <Field label="Email" k="email" readOnly />
          <Field label="Phone" k="phone" />
        </div>

        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '24px 0 14px' }}>
          Medical information
        </h3>
        <div className="profile-grid">
          <div>
            <label className="label">Blood type</label>
            <select
              className="select"
              value={form.bloodType}
              onChange={(e) => upd('bloodType', e.target.value)}
              disabled={!editing}
            >
              {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b || '— select —'}</option>)}
            </select>
          </div>
          <Field label="Allergies" k="allergies" textarea />
          <Field label="Chronic conditions" k="chronicConditions" textarea />
          <Field label="Current medications" k="currentMedications" textarea />
        </div>

        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '24px 0 14px' }}>
          Insurance
        </h3>
        <div className="profile-grid">
          <Field label="Insurance provider" k="insuranceProvider" />
          <Field label="Insurance number" k="insuranceNumber" />
        </div>

        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '24px 0 14px' }}>
          Emergency contact
        </h3>
        <div className="profile-grid">
          <Field label="Contact name" k="emergencyContactName" />
          <Field label="Contact phone" k="emergencyContactPhone" />
        </div>
      </div>
    </div>
  );
}
