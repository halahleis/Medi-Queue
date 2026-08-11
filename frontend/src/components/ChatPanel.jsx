import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api/client';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';

const QUICK_ACTIONS = [
  { key: 'acknowledged', label: 'Well Received', message: 'Well received. I will update the queue accordingly.' },
  { key: 'delay_check', label: 'Delay Check', message: 'Are you running late? If yes, how many minutes should I delay the remaining queue?' },
  { key: 'ready_for_next', label: 'Ready for Next', message: 'Are you ready for the next patient?' },
  { key: 'emergency_check', label: 'Emergency', message: 'Do you need us to pause or cancel the remaining appointments for today?' },
];

export default function ChatPanel({ doctorId, doctorName, date }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  // Load history whenever the doctor or date changes.
  useEffect(() => {
    if (!doctorId) return;
    let active = true;
    (async () => {
      try {
        const { data } = await api.get(`/staff/chat/${doctorId}`, { params: { date } });
        if (active) setMessages(data.messages || []);
      } catch (err) {
        console.error('Failed to load chat:', err);
      }
    })();
    return () => { active = false; };
  }, [doctorId, date]);

  // Subscribe to live chat events for this doctor.
  useEffect(() => {
    if (!doctorId) return;
    const sock = getSocket();
    if (!sock) return;

    const handler = (msg) => {
      setMessages((prev) => {
        // De-dupe (in case the sender's POST already inserted the message).
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    sock.emit('chat:subscribe', { doctorId });
    sock.on('chat:new', handler);
    return () => {
      sock.emit('chat:unsubscribe', { doctorId });
      sock.off('chat:new', handler);
    };
  }, [doctorId]);

  // Auto-scroll to bottom whenever messages or the open state changes.
  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = async (message, quickAction = null) => {
    const trimmed = message.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      const { data } = await api.post(`/staff/chat/${doctorId}`, {
        message: trimmed,
        quickAction,
      });
      // Optimistic-style append (the socket may or may not echo back to the sender).
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id)
          ? prev
          : [...prev, { ...data.message, sender_role: user.role, sender_name: user.fullName }]
      );
      setText('');
    } catch (err) {
      toast.error(err.displayMessage || 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  if (!doctorId) return null;

  if (!open) {
    return (
      <button
        className="chat-fab"
        onClick={() => setOpen(true)}
        title={`Chat with ${doctorName || 'doctor'}`}
      >
        💬
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div>
          <div>{doctorName || 'Doctor'}</div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
            Operational chat · {date}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>×</button>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="empty">No messages yet today. Say hi or use a quick action below.</div>
        )}
        {messages.map((m) => {
          const mine = m.sender_user_id === user.id;
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'me' : 'them'}`}>
              {!mine && (
                <div className="bold" style={{ fontSize: 11, marginBottom: 2 }}>
                  {m.sender_name || (m.sender_role === 'doctor' ? 'Doctor' : 'Staff')}
                </div>
              )}
              <div>{m.message}</div>
              <div className="meta">
                {new Date(m.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="chat-quicks">
        {QUICK_ACTIONS.map((q) => (
          <button
            key={q.key}
            className="btn btn-outline btn-xs"
            disabled={sending}
            onClick={() => send(q.message, q.key)}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="chat-input-row">
        <input
          className="input"
          placeholder="Type a short message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          disabled={sending}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={() => send(text)}
          disabled={sending || !text.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
