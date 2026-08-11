import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getSocket } from '../../api/socket';
import { useAuth } from '../../context/AuthContext';

export default function ContactPage() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState([]);
  const [selectedApptId, setSelectedApptId] = useState('');
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await api.get('/patient/staff-contact-options');
        if (!active) return;
        const rows = data.appointments || [];
        setAppointments(rows);
        if (rows.length) setSelectedApptId(rows[0].appointment_id);
      } catch (err) {
        toast.error(err.displayMessage || 'Could not load same-day appointments.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedApptId) {
      setConversation(null);
      setMessages([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const { data } = await api.get('/patient/staff-conversation', {
          params: { appointmentId: selectedApptId },
        });
        if (!active) return;
        setConversation(data.conversation);
        setMessages(data.messages || []);
      } catch (err) {
        toast.error(err.displayMessage || 'Could not load messages.');
      }
    })();
    return () => { active = false; };
  }, [selectedApptId]);

  useEffect(() => {
    if (!conversation?.id) return;
    const sock = getSocket();
    if (!sock) return;
    const onNew = ({ conversationId, message }) => {
      if (conversationId !== conversation.id) return;
      setMessages((prev) => prev.some((m) => m.id === message.id) ? prev : [...prev, message]);
    };
    const onStatus = ({ conversation: next }) => {
      if (next?.id === conversation.id) setConversation(next);
    };
    sock.emit('patient_staff:subscribe', { conversationId: conversation.id });
    sock.on('patient_staff:new', onNew);
    sock.on('patient_staff:status', onStatus);
    return () => {
      sock.emit('patient_staff:unsubscribe', { conversationId: conversation.id });
      sock.off('patient_staff:new', onNew);
      sock.off('patient_staff:status', onStatus);
    };
  }, [conversation?.id]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages]);

  const selected = appointments.find((a) => a.appointment_id === selectedApptId);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || !selectedApptId) return;
    setSending(true);
    try {
      const { data } = await api.post('/patient/staff-conversation/messages', {
        appointmentId: selectedApptId,
        message: trimmed,
      });
      setMessages((prev) => prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]);
      setText('');
    } catch (err) {
      toast.error(err.displayMessage || 'Could not send message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="patient-page">
      <div className="section-title">
        <h2>CONTACT <span style={{ color: 'var(--primary)' }}>STAFF</span></h2>
        <p>Available only for active appointments scheduled for today.</p>
      </div>

      {loading && <div className="empty">Loading...</div>}
      {!loading && appointments.length === 0 && (
        <div className="empty">You can contact staff only on the same day as an active appointment.</div>
      )}

      {!loading && appointments.length > 0 && (
        <div className="patient-message-shell">
          <div className="patient-message-sidebar">
            <h3>Today's appointments</h3>
            <div className="col" style={{ gap: 10 }}>
              {appointments.map((appt) => (
                <button
                  key={`${appt.appointment_id}-${appt.staff_id || 'staff'}`}
                  className={`contact-appt-option ${appt.appointment_id === selectedApptId ? 'active' : ''}`}
                  onClick={() => setSelectedApptId(appt.appointment_id)}
                >
                  <strong>{appt.doctor_name}</strong>
                  <span>{String(appt.start_time || '').slice(0, 5)}</span>
                  <small>Staff: {appt.staff_name || 'Reception team'}</small>
                </button>
              ))}
            </div>
            {selected && (
              <p style={{ marginTop: 16 }}>
                You are contacting {selected.staff_name || 'the reception team'} about your {String(selected.start_time || '').slice(0, 5)} appointment.
              </p>
            )}
          </div>

          <div className="patient-message-chat">
            <div className="patient-message-body" ref={bodyRef}>
              {messages.length === 0 && (
                <div className="empty">No messages yet. Start the conversation below.</div>
              )}
              {messages.map((m) => {
                const mine = m.sender_user_id === user.id;
                return (
                  <div key={m.id} className={`chat-msg ${mine ? 'me' : 'them'}`}>
                    {!mine && (
                      <div className="bold" style={{ fontSize: 11, marginBottom: 2 }}>
                        {m.sender_name || selected?.staff_name || 'Staff'}
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

            <div className="chat-input-row">
              <input
                className="input"
                placeholder="Type your message..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    send();
                  }
                }}
                disabled={sending}
              />
              <button className="btn btn-primary btn-sm" onClick={send} disabled={sending || !text.trim()}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
