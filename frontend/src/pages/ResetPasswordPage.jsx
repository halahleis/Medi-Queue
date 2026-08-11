import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/client';
import PasswordRules from '../components/PasswordRules.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { passwordMessage } from '../utils/formValidation';

export default function ResetPasswordPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const initialEmail = useMemo(() => params.get('email') || '', [params]);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    const passwordError = passwordMessage(password);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { email, code, password });
      toast.success('Password changed. Sign in with your new password.');
      nav('/login');
    } catch (err) {
      toast.error(err.displayMessage || 'Could not reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="row" style={{ marginBottom: 18 }}>
          <div className="topbar-brand-logo">M</div>
          <div className="bold tight" style={{ fontSize: 18 }}>MediQueue</div>
        </div>
        <h1>Reset password</h1>
        <p>Enter the code from your email and choose a new password.</p>

        <div className="field">
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="label">Email code</label>
          <input
            className="input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            required
          />
        </div>

        <div className="field">
          <label className="label">New password</label>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />
          <PasswordRules password={password} />
        </div>

        <div className="field">
          <label className="label">Confirm new password</label>
          <PasswordInput
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            minLength={8}
            required
            autoComplete="new-password"
          />
        </div>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? 'Changing password...' : 'Change password'}
        </button>

        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          Need a new code? <Link to="/forgot-password" style={{ fontWeight: 500 }}>Send another email</Link>
        </div>
      </form>
    </div>
  );
}
