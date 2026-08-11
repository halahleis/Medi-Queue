import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api/client';
import { getSocket } from '../api/socket';
import { useAuth } from '../context/AuthContext';
import Modal from './Modal.jsx';

export default function PatientStaffInbox({ open, onClose }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId),
    [conversations, selectedId]
  );

  const loadThreads = async () => {
    const { data } = await api.get('/staff/patient-conversations');
    setConversations(data.conversations || []);
    if (!selectedId && data.conversations?.length) {
      setSelectedId(data.conversations[0].id);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadThreads().catch((err) => toast.error(err.displayMessage || 'Could not load patient messages.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !selectedId) return;
    let active = true;
    setLoading(true);
    api.get(`/staff/patient-conversations/${selectedId}`)
      .then(({ data }) => {
        if (!active) return;
        setMessages(data.messages || []);
        setConversations((prev) =>
          prev.map((c) => c.id === data.conversation.id
            ? { ...c, ...data.conversation, unread_count: 0 }
            : c)
        );
      })
      .catch((err) => toast.error(err.displayMessage || 'Could not load conversation.'))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, selectedId]);

  useEffect(() => {
    if (!open) return;
    const sock = getSocket();
    if (!sock) return;
    const onNew = ({ conversation, message }) => {
      setConversations((prev) => upsertConversation(prev, conversation, message, selectedId));
      if (message.conversation_id === selectedId) {
        setMessages((prev) => prev.some((m) => m.id === message.id) ? prev : [...prev, message]);
      }
    };
    const onStatus = ({ conversation }) => {
      setConversations((prev) => prev.map((c) => c.id === conversation.id ? { ...c, ...conversation } : c));
    };
    sock.on('patient_staff:new', onNew);
    sock.on('patient_staff:status', onStatus);
    return () => {
      sock.off('patient_staff:new', onNew);
      sock.off('patient_staff:status', onStatus);
    };
  }, [open, selectedId]);

  useEffect(() => {
    const sock = getSocket();
    if (!sock || !selectedId) return;
    sock.emit('patient_staff:subscribe', { conversationId: selectedId });
    return () => sock.emit('patient_staff:unsubscribe', { conversationId: selectedId });
  }, [selectedId]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, selectedId]);

  const send = async () => {
    const trimmed = text.trim();
    if (!selectedId || !trimmed) return;
    setSending(true);
    try {
      const { data } = await api.post(`/staff/patient-conversations/${selectedId}/messages`, {
        message: trimmed,
      });
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]
      );
      setText('');
      await loadThreads();
    } catch (err) {
      toast.error(err.displayMessage || 'Could not send reply.');
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status) => {
    if (!selectedId) return;
    try {
      const { data } = await api.patch(`/staff/patient-conversations/${selectedId}/status`, { status });
      setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, ...data.conversation } : c));
    } catch (err) {
      toast.error(err.displayMessage || 'Could not update status.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Patient messages" width={900}>
      <div className="patient-inbox">
        <div className="patient-inbox-list">
          {conversations.length === 0 && <div className="empty">No patient messages yet.</div>}
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`patient-thread ${c.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(c.id)}
            >
              <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                <strong>{c.patient_name}</strong>
                {c.unread_count > 0 && <span className="badge badge-info">{c.unread_count}</span>}
              </div>
              <div className="muted">{c.patient_phone || c.patient_email || 'Patient'}</div>
              <div className="patient-thread-preview">{c.last_message || c.subject}</div>
              <span className={`badge ${c.status === 'resolved' ? 'badge-success' : 'badge-muted'}`}>
                {statusLabel(c.status)}
              </span>
            </button>
          ))}
        </div>

        <div className="patient-inbox-chat">
          {!selected ? (
            <div className="empty">Select a conversation.</div>
          ) : (
            <>
              <div className="patient-inbox-header">
                <div>
                  <div className="bold">{selected.patient_name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {selected.patient_phone || selected.patient_email || 'No contact details'}
                  </div>
                </div>
                <div className="row">
                  <button className="btn btn-outline btn-sm" onClick={() => setStatus('open')}>Open</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setStatus('resolved')}>Resolve</button>
                </div>
              </div>

              <div className="patient-inbox-body" ref={bodyRef}>
                {loading && <div className="empty">Loading conversation...</div>}
                {!loading && messages.length === 0 && <div className="empty">No messages yet.</div>}
                {messages.map((m) => {
                  const mine = m.sender_user_id === user.id;
                  return (
                    <div key={m.id} className={`chat-msg ${mine ? 'me' : 'them'}`}>
                      {!mine && <div className="bold" style={{ fontSize: 11, marginBottom: 2 }}>{m.sender_name}</div>}
                      <div>{m.message}</div>
                      <div className="meta">
                        {new Date(m.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="chat-input-row">
                <input
                  className="input"
                  placeholder="Reply to patient..."
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      send();
                    }
                  }}
                  disabled={sending || selected.status === 'resolved'}
                />
                <button className="btn btn-primary btn-sm" onClick={send} disabled={sending || !text.trim() || selected.status === 'resolved'}>
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function upsertConversation(items, conversation, message, selectedId) {
  const next = items.filter((c) => c.id !== conversation.id);
  const previous = items.find((c) => c.id === conversation.id);
  next.unshift({
    ...previous,
    ...conversation,
    last_message: message.message,
    last_message_sent_at: message.sent_at,
    unread_count: message.sender_role === 'patient' && conversation.id !== selectedId
      ? Number(previous?.unread_count || 0) + 1
      : Number(previous?.unread_count || 0),
  });
  return next;
}

function statusLabel(status) {
  if (status === 'pending_patient') return 'Waiting on patient';
  if (status === 'resolved') return 'Resolved';
  return 'Open';
}
