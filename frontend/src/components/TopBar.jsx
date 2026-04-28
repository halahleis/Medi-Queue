import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function TopBar({ activeTab, onTabChange, tabs = [] }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  const handleLogout = () => {
    logout();
    nav('/login');
  };

  const initials = (user?.fullName || user?.email || '?')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="topbar-brand-logo">M</div>
        <span>MediQueue</span>
      </div>

      <nav className="topbar-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`topbar-tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => onTabChange?.(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="topbar-user">
        <span className="muted" style={{ fontSize: 13 }}>
          {user?.fullName || user?.email}
        </span>
        <div className="avatar">{initials}</div>
        <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout</button>
      </div>
    </header>
  );
}
