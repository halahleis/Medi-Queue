import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import PhoneInput from '../../components/PhoneInput.jsx';
import { findCountry, parseInternationalPhone, validateNationalPhone } from '../../utils/formValidation';

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

  if (!form) return <div className="patient-page"><div className="empty">Loading...</div></div>;

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onSave = async () => {
    const phoneParsed = parseInternationalPhone(form.phone);
    const phoneError = validateNationalPhone(findCountry(phoneParsed.countryCode), phoneParsed.nationalNumber);
    if (phoneError) {
      toast.error(phoneError);
      return;
    }

    const emergencyParsed = parseInternationalPhone(form.emergencyContactPhone);
    const emergencyPhoneError = validateNationalPhone(findCountry(emergencyParsed.countryCode), emergencyParsed.nationalNumber);
    if (emergencyPhoneError) {
      toast.error(`Emergency contact: ${emergencyPhoneError}`);
      return;
    }

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
              {busy ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 14px' }}>
          Contact information
        </h3>
        <div className="profile-grid">
          <ProfileField label="Full name" value={form.fullName} onChange={(value) => upd('fullName', value)} editing={editing} />
          <ProfileField label="Email" value={form.email} onChange={(value) => upd('email', value)} editing={editing} readOnly />
          <PhoneInput value={form.phone} onChange={(value) => upd('phone', value)} disabled={!editing} />
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
              {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b || '-- select --'}</option>)}
            </select>
          </div>
          <ProfileField label="Allergies" value={form.allergies} onChange={(value) => upd('allergies', value)} editing={editing} textarea />
          <ProfileField label="Chronic conditions" value={form.chronicConditions} onChange={(value) => upd('chronicConditions', value)} editing={editing} textarea />
          <ProfileField label="Current medications" value={form.currentMedications} onChange={(value) => upd('currentMedications', value)} editing={editing} textarea />
        </div>

        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '24px 0 14px' }}>
          Insurance
        </h3>
        <div className="profile-grid">
          <ProfileField label="Insurance provider" value={form.insuranceProvider} onChange={(value) => upd('insuranceProvider', value)} editing={editing} />
          <ProfileField label="Insurance number" value={form.insuranceNumber} onChange={(value) => upd('insuranceNumber', value)} editing={editing} />
        </div>

        <h3 style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '24px 0 14px' }}>
          Emergency contact
        </h3>
        <div className="profile-grid">
          <ProfileField label="Contact name" value={form.emergencyContactName} onChange={(value) => upd('emergencyContactName', value)} editing={editing} />
          <PhoneInput
            label="Contact phone"
            value={form.emergencyContactPhone}
            onChange={(value) => upd('emergencyContactPhone', value)}
            disabled={!editing}
          />
        </div>
      </div>
    </div>
  );
}

function ProfileField({ label, value, onChange, type = 'text', readOnly = false, textarea = false, editing }) {
  return (
    <div>
      <label className="label">{label}</label>
      {textarea ? (
        <textarea
          className="input"
          rows={2}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={!editing || readOnly}
        />
      ) : (
        <input
          className="input"
          type={type}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={!editing || readOnly}
        />
      )}
    </div>
  );
}
