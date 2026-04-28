import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../../api/client';
import { getSocket } from '../../api/socket';
import toast from 'react-hot-toast';
import ConsultationModal from './ConsultationModal.jsx';

const COLUMNS = [
  { key: 'waiting',         label: 'Waiting Room' },
  { key: 'in_consultation', label: 'In Consultation' },
  { key: 'completed',       label: 'Completed' },
];

export default function DoctorQueueTab() {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null); // queue entry being viewed/edited
  const subRef = useRef(null);

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/doctor/board', { params: { date: today } });
      setBoard(data);
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load queue.');
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => { load(); }, [load]);

  // Subscribe to live board updates so the doctor sees staff actions instantly.
  useEffect(() => {
    if (!board?.doctor?.id) return;
    const sock = getSocket();
    if (!sock) return;

    if (subRef.current) sock.emit('board:unsubscribe', subRef.current);
    sock.emit('board:subscribe', { doctorId: board.doctor.id, date: today });
    subRef.current = { doctorId: board.doctor.id, date: today };

    const onUpdate = (payload) => {
      if (payload.doctorId === board.doctor.id && payload.date === today) load();
    };
    sock.on('board:update', onUpdate);

    return () => {
      sock.off('board:update', onUpdate);
      sock.emit('board:unsubscribe', subRef.current);
    };
  }, [board?.doctor?.id, today, load]);

  if (loading) return <div className="empty">Loading queue…</div>;
  if (!board) return null;

  const grouped = (status) =>
    (board.entries || []).filter((e) => e.kanban_status === status);

  return (
    <>
      <div className="doctor-header">
        <h1>Today's queue</h1>
        <span className="muted" style={{ fontSize: 13 }}>
          {(board.entries || []).length} appointments today
        </span>
      </div>

      <div className="doc-board">
        {COLUMNS.map((col) => {
          const items = grouped(col.key);
          return (
            <section key={col.key} className="doc-col">
              <h4>
                <span>{col.label}</span>
                <span className="count">{items.length}</span>
              </h4>
              {items.length === 0 && <div className="empty" style={{ padding: 18 }}>Nothing here.</div>}
              {items.map((e) => (
                <div
                  key={e.id}
                  className={`doc-card ${e.kanban_status}`}
                  onClick={() => setActive(e)}
                >
                  <div className="dc-row">
                    <span className="dc-name">{e.patient_name}</span>
                    <span className="dc-time">{e.scheduled_start_time?.slice(0, 5)}</span>
                  </div>
                  <div className="dc-meta">
                    {e.arrival_tag && (
                      <span className={`arrival-tag ${e.arrival_tag}`} style={{ marginRight: 6 }}>
                        {e.arrival_tag.replace('_', ' ')}
                      </span>
                    )}
                    {e.actual_start_time && <span>Started {e.actual_start_time?.slice(0, 5)}</span>}
                    {e.kanban_status === 'completed' && e.actual_end_time && (
                      <span>Ended {e.actual_end_time?.slice(0, 5)}</span>
                    )}
                    {e.visit_type === 'follow_up' && (
                      <span className="badge badge-info" style={{ marginLeft: 6 }}>Follow-up</span>
                    )}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>

      <div className="muted" style={{ marginTop: 14, fontSize: 12 }}>
        Click any patient card to view details, record consultation notes,
        write prescriptions, or complete the visit.
      </div>

      <ConsultationModal
        entry={active}
        onClose={() => setActive(null)}
        onCompleted={() => { setActive(null); load(); }}
      />
    </>
  );
}
