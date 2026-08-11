import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(email, password);
      toast.success(`Welcome, ${user.fullName || user.email}`);
      if (user.role === 'staff') nav('/staff');
      else if (user.role === 'admin') nav('/admin');
      else if (user.role === 'doctor') nav('/doctor');
      else if (user.role === 'patient') nav('/home');
    } catch (err) {
      toast.error(err.displayMessage || 'Login failed.');
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
        <h1>Sign in</h1>
        <p>Sign in to book appointments and track your queue.</p>

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

        <div className="field">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <label className="label" style={{ marginBottom: 0 }}>Password</label>
            <Link to="/forgot-password" style={{ fontSize: 12, fontWeight: 600 }}>Forgot password?</Link>
          </div>
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        <button className="btn btn-primary" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          New here?{' '}
          <Link to="/register" style={{ fontWeight: 500 }}>Create an account</Link>
        </div>

        <div className="login-hint">
          <strong>Demo accounts (password: Password123!):</strong><br />
          Staff: maria@mediqueue.test<br />
          Admin: admin@mediqueue.test
        </div>
      </form>
    </div>
  );
}
