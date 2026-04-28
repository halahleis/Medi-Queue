import { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import { getSocket } from '../../api/socket';
import NotificationsPanel from '../../components/patient/NotificationsPanel.jsx';

export default function PatientLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  // Poll for notification count every 30s when logged in. The socket also
  // pushes patient:status events; we treat those as a hint to fetch fresh.
  useEffect(() => {
    if (!user || user.role !== 'patient') return;
    let active = true;
    const fetch = async () => {
      try {
        const { data } = await api.get('/patient/notifications');
        if (active) setNotifCount((data.notifications || []).length);
      } catch { /* ignore */ }
    };
    fetch();

    const sock = getSocket();
    const onStatus = () => fetch();
    sock?.on?.('patient:status', onStatus);

    const id = setInterval(fetch, 30 * 1000);
    return () => {
      active = false;
      clearInterval(id);
      sock?.off?.('patient:status', onStatus);
    };
  }, [user]);

  const handleLogout = () => {
    logout();
    nav('/home');
  };

  const initials = (user?.fullName || user?.email || '?')
    .split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="patient-shell">
      <header className="topbar">
        <Link to="/home" className="topbar-brand" style={{ textDecoration: 'none' }}>
          <div className="topbar-brand-logo">M</div>
          <span>MediQueue</span>
        </Link>

        <nav className="topbar-tabs">
          <NavLink to="/home"    className={({isActive}) => `topbar-tab ${isActive ? 'active' : ''}`}>Home</NavLink>
          <NavLink to="/doctors" className={({isActive}) => `topbar-tab ${isActive ? 'active' : ''}`}>All Doctors</NavLink>
          <NavLink to="/about"   className={({isActive}) => `topbar-tab ${isActive ? 'active' : ''}`}>About</NavLink>
          <NavLink to="/contact" className={({isActive}) => `topbar-tab ${isActive ? 'active' : ''}`}>Contact</NavLink>
        </nav>

        <div className="topbar-user">
          {user && user.role === 'patient' ? (
            <>
              {/* Bell */}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setNotifOpen((o) => !o)}
                title="Notifications"
                style={{ position: 'relative' }}
              >
                🔔
                {notifCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: 2, right: 2,
                    background: 'var(--danger)',
                    color: 'white',
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 5px',
                    borderRadius: 8,
                    minWidth: 16,
                    textAlign: 'center',
                  }}>{notifCount > 9 ? '9+' : notifCount}</span>
                )}
              </button>

              {/* Profile menu */}
              <div style={{ position: 'relative' }}>
                <button
                  className="row"
                  onClick={() => setMenuOpen((o) => !o)}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 4, gap: 8,
                  }}
                >
                  <div className="avatar">{initials}</div>
                  <span className="muted" style={{ fontSize: 13 }}>▾</span>
                </button>
                {menuOpen && (
                  <div
                    onMouseLeave={() => setMenuOpen(false)}
                    style={{
                      position: 'absolute', right: 0, top: 'calc(100% + 6px)',
                      background: 'var(--surface)',
                      border: '1px solid var(--border-soft)',
                      borderRadius: 'var(--radius)',
                      boxShadow: 'var(--shadow)',
                      minWidth: 180,
                      padding: 6,
                      zIndex: 90,
                    }}
                  >
                    <MenuItem onClick={() => { setMenuOpen(false); nav('/profile'); }}>My Profile</MenuItem>
                    <MenuItem onClick={() => { setMenuOpen(false); nav('/my-appointments'); }}>My Appointments</MenuItem>
                    <div style={{ borderTop: '1px solid var(--border-soft)', margin: '6px 0' }} />
                    <MenuItem onClick={handleLogout}>Logout</MenuItem>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => nav('/register')}>
              Create account
            </button>
          )}
        </div>
      </header>

      {notifOpen && (
        <NotificationsPanel onClose={() => setNotifOpen(false)} />
      )}

      <main style={{ flex: 1 }}>
        <Outlet />
      </main>

      <footer style={{ borderTop: '1px solid var(--border-soft)', padding: '24px 28px', marginTop: 40 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          © {new Date().getFullYear()} MediQueue · Hospital Appointment & Queue System
        </div>
      </footer>
    </div>
  );
}

function MenuItem({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%',
        padding: '8px 12px', background: 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        fontSize: 13, color: 'var(--text)',
        borderRadius: 'var(--radius-sm)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--border-soft)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      {children}
    </button>
  );
}
