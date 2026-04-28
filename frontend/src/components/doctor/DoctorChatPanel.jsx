import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getSocket } from '../../api/socket';
import { useAuth } from '../../context/AuthContext';

/**
 * Doctor-side chat panel — the mirror of staff ChatPanel. Operationally
 * identical from the user's point of view: a floating bottom-right panel
 * with quick-action buttons and free-form text. The doctor's id is
 * implicit (server-side, derived from the JWT) so we don't need to pass
 * it in here.
 */
const QUICK_ACTIONS = [
  { key: 'running_late',   label: 'Running Late',   message: "I'm running late." },
  { key: 'ready_for_next', label: 'Ready for Next', message: 'Ready for the next patient.' },
  { key: 'pause_queue',    label: 'Pause Queue',    message: 'Please pause the queue.' },
  { key: 'resume_queue',   label: 'Resume Queue',   message: 'Queue can resume.' },
];

export default function DoctorChatPanel() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  const today = new Date().toISOString().slice(0, 10);
  const doctorId = user?.profileId;

  // Load chat history once on mount (and again if the user changes).
  useEffect(() => {
    if (!doctorId) return;
    let active = true;
    (async () => {
      try {
        const { data } = await api.get('/doctor/chat', { params: { date: today } });
        if (active) setMessages(data.messages || []);
      } catch (err) {
        console.error('Failed to load chat:', err);
      }
    })();
    return () => { active = false; };
  }, [doctorId, today]);

  // Subscribe to the doctor's chat room — staff messages arrive here in real time.
  useEffect(() => {
    if (!doctorId) return;
    const sock = getSocket();
    if (!sock) return;

    const handler = (msg) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    };
    sock.emit('chat:subscribe', { doctorId });
    sock.on('chat:new', handler);
    return () => {
      sock.emit('chat:unsubscribe', { doctorId });
      sock.off('chat:new', handler);
    };
  }, [doctorId]);

  // Auto-scroll to latest message.
  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, open]);

  const send = async (message, quickAction = null) => {
    const trimmed = (message || '').trim();
    if (!trimmed) return;
    setSending(true);
    try {
      const { data } = await api.post('/doctor/chat', { message: trimmed, quickAction });
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id)
          ? prev
          : [...prev, { ...data.message, sender_role: 'doctor', sender_name: user?.fullName }]
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
      <button className="chat-fab" onClick={() => setOpen(true)} title="Reception chat">💬</button>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div>
          <div>Reception</div>
          <div className="muted" style={{ fontSize: 11, fontWeight: 400 }}>
            Operational chat · {today}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>×</button>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="empty">No messages yet today. Use a quick action below or say hi.</div>
        )}
        {messages.map((m) => {
          const mine = m.sender_user_id === user?.id;
          return (
            <div key={m.id} className={`chat-msg ${mine ? 'me' : 'them'}`}>
              {!mine && (
                <div className="bold" style={{ fontSize: 11, marginBottom: 2 }}>
                  {m.sender_name || (m.sender_role === 'staff' ? 'Reception' : 'Staff')}
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
