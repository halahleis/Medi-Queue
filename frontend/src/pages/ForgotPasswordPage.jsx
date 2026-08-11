import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/client';

export default function ForgotPasswordPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      toast.success('Reset code sent. Check your email.');
      nav(`/reset-password?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err) {
      toast.error(err.displayMessage || 'Could not send reset code.');
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
        <h1>Forgot password</h1>
        <p>Enter your account email. If it exists, we will email you a reset code.</p>

        <div className="field">
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? 'Sending code...' : 'Send reset code'}
        </button>

        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          Remembered it? <Link to="/login" style={{ fontWeight: 500 }}>Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
