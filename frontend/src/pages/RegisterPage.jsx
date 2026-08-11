import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import PasswordRules from '../components/PasswordRules.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import PhoneInput from '../components/PhoneInput.jsx';
import { findCountry, parseInternationalPhone, passwordMessage, validateNationalPhone } from '../utils/formValidation';

const BLOOD_TYPES = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function RegisterPage() {
  const nav = useNavigate();
  const { login } = useAuth();
  const [showOptional, setShowOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: '', password: '', confirmPassword: '',
    fullName: '', phone: '',
    allergies: '', chronicConditions: '', currentMedications: '', bloodType: '',
    insuranceProvider: '', insuranceNumber: '',
    emergencyContactName: '', emergencyContactPhone: '',
  });

  const upd = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    const passwordError = passwordMessage(form.password);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }
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
      // Register, then auto-login by reusing the returned token through the auth context.
      await api.post('/auth/register', form);
      // Use the standard login flow so AuthContext stores token and user.
      await login(form.email, form.password);
      toast.success('Welcome to MediQueue!');
      nav('/home');
    } catch (err) {
      toast.error(err.displayMessage || 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page" style={{ alignItems: 'flex-start', paddingTop: 32, paddingBottom: 32 }}>
      <form
        className="login-card"
        onSubmit={onSubmit}
        style={{ width: 480, maxWidth: '100%' }}
      >
        <div className="row" style={{ marginBottom: 18 }}>
          <div className="topbar-brand-logo">M</div>
          <div className="bold tight" style={{ fontSize: 18 }}>MediQueue</div>
        </div>
        <h1>Create your account</h1>
        <p>Sign up to book appointments with our doctors.</p>

        <div className="field">
          <label className="label">Full name *</label>
          <input className="input" value={form.fullName} onChange={(e) => upd('fullName', e.target.value)} required />
        </div>

        <div className="field">
          <label className="label">Email *</label>
          <input className="input" type="email" value={form.email} onChange={(e) => upd('email', e.target.value)} required />
        </div>

        <div className="field">
          <PhoneInput value={form.phone} onChange={(value) => upd('phone', value)} />
        </div>

        <div className="field">
          <label className="label">Password *</label>
          <PasswordInput
            value={form.password}
            onChange={(e) => upd('password', e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
          <PasswordRules password={form.password} />
        </div>

        <div className="field">
          <label className="label">Confirm password *</label>
          <PasswordInput
            value={form.confirmPassword}
            onChange={(e) => upd('confirmPassword', e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setShowOptional((s) => !s)}
          style={{ marginTop: 4, marginBottom: 8, padding: 0 }}
        >
          {showOptional ? '− Hide medical info' : '+ Add medical info (optional)'}
        </button>

        {showOptional && (
          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14, marginBottom: 8 }}>
            <div className="field">
              <label className="label">Blood type</label>
              <select className="select" value={form.bloodType} onChange={(e) => upd('bloodType', e.target.value)}>
                {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b || '— select —'}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Allergies</label>
              <textarea className="input" rows={2} value={form.allergies} onChange={(e) => upd('allergies', e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Chronic conditions</label>
              <textarea className="input" rows={2} value={form.chronicConditions} onChange={(e) => upd('chronicConditions', e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Current medications</label>
              <textarea className="input" rows={2} value={form.currentMedications} onChange={(e) => upd('currentMedications', e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Insurance provider</label>
              <input className="input" value={form.insuranceProvider} onChange={(e) => upd('insuranceProvider', e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Insurance number</label>
              <input className="input" value={form.insuranceNumber} onChange={(e) => upd('insuranceNumber', e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Emergency contact name</label>
              <input className="input" value={form.emergencyContactName} onChange={(e) => upd('emergencyContactName', e.target.value)} />
            </div>
            <div className="field">
              <PhoneInput
                label="Emergency contact phone"
                value={form.emergencyContactPhone}
                onChange={(value) => upd('emergencyContactPhone', value)}
              />
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Medical info is optional during signup — you can fill it in later from your profile.
            </div>
          </div>
        )}

        <button className="btn btn-primary" disabled={busy} style={{ marginTop: 12 }}>
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          Already have an account?{' '}
          <Link to="/login" style={{ fontWeight: 500 }}>Sign in</Link>
        </div>
      </form>
    </div>
  );
}
