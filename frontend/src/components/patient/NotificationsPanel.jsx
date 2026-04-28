import { useEffect, useState } from 'react';
import api from '../../api/client';

export default function NotificationsPanel({ onClose }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await api.get('/patient/notifications');
        if (active) setItems(data.notifications || []);
      } catch { /* ignore */ }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  return (
    <div className="notif-panel" onMouseLeave={onClose}>
      <div className="notif-panel-header">
        <strong style={{ fontSize: 14 }}>Notifications</strong>
        <button className="btn btn-ghost btn-xs" onClick={onClose}>×</button>
      </div>
      <div className="notif-panel-body">
        {loading && <div className="empty">Loading…</div>}
        {!loading && items.length === 0 && <div className="empty">You're all caught up.</div>}
        {!loading && items.map((n) => (
          <div key={n.id} className="notif-item">
            <div className="title">{n.title}</div>
            <div className="msg">{n.message}</div>
            <div className="time">{new Date(n.sent_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
