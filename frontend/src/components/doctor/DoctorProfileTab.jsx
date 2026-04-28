import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';

export default function DoctorProfileTab() {
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({});

  const load = async () => {
    try {
      const { data } = await api.get('/doctor/profile');
      setProfile(data.profile);
      setForm({
        fullName: data.profile.full_name || '',
        specialty: data.profile.specialty || '',
        qualifications: data.profile.qualifications || '',
        biography: data.profile.biography || '',
        standardFee: data.profile.standard_fee ?? 0,
        followupFee: data.profile.followup_fee ?? 0,
        appointmentDurationMinutes: data.profile.appointment_duration_minutes ?? 20,
        phone: data.profile.phone || '',
      });
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load profile.');
    }
  };
  useEffect(() => { load(); }, []);

  if (!profile) return <div className="empty">Loading profile…</div>;

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/doctor/profile', form);
      toast.success('Profile updated.');
      setEditing(false);
      load();
    } catch (err) {
      toast.error(err.displayMessage || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="doctor-header">
        <h1>My Profile</h1>
        {!editing
          ? <button className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>Edit</button>
          : <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); load(); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>}
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 14px' }}>
          Public information
        </h3>

        <div className="form-grid">
          <Field label="Full name"      k="fullName"      form={form} upd={upd} editing={editing} />
          <Field label="Specialty"      k="specialty"     form={form} upd={upd} editing={editing} />
          <Field label="Qualifications" k="qualifications" form={form} upd={upd} editing={editing} />
          <div className="full">
            <label className="label">Biography</label>
            <textarea
              className="input" rows={3}
              value={form.biography || ''}
              onChange={(e) => upd('biography', e.target.value)}
              disabled={!editing}
            />
          </div>
        </div>

        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '24px 0 14px' }}>
          Fees & duration
        </h3>
        <div className="form-grid">
          <Field label="Standard fee ($)"   k="standardFee" form={form} upd={upd} editing={editing} type="number" />
          <Field label="Follow-up fee ($)"  k="followupFee" form={form} upd={upd} editing={editing} type="number" />
          <Field label="Appointment duration (min)" k="appointmentDurationMinutes" form={form} upd={upd} editing={editing} type="number" />
        </div>

        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '24px 0 14px' }}>
          Contact
        </h3>
        <div className="form-grid">
          <div>
            <label className="label">Email</label>
            <input className="input" value={profile.email} disabled />
          </div>
          <Field label="Phone" k="phone" form={form} upd={upd} editing={editing} />
          <div>
            <label className="label">Department</label>
            <input className="input" value={profile.department_name || '— Unassigned —'} disabled />
          </div>
        </div>

        <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Department assignment and account active status are controlled by the hospital
          administrator. Contact admin if those need to change.
        </div>
      </div>
    </>
  );
}

function Field({ label, k, form, upd, editing, type = 'text' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        type={type}
        value={form[k] ?? ''}
        onChange={(e) => upd(k, e.target.value)}
        disabled={!editing}
      />
    </div>
  );
}
