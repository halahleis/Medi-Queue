import { fmtTime, timeToMin } from '../utils/time';

export default function ReferenceSidebar({ entries, nowMin }) {
  const sorted = [...entries].sort(
    (a, b) => timeToMin(a.scheduled_start_time) - timeToMin(b.scheduled_start_time)
  );

  const dotClass = (entry) => {
    if (entry.kanban_status === 'completed') return 'completed';
    if (entry.kanban_status === 'in_consultation') return 'current';
    if (entry.kanban_status === 'rejected' || entry.kanban_status === 'no_show') return 'late';
    if (entry.arrival_tag === 'late') return 'late';
    const start = timeToMin(entry.scheduled_start_time);
    if (start < nowMin) return 'past';
    return 'future';
  };

  return (
    <aside className="ref-card">
      <h3>Original Schedule</h3>
      {sorted.length === 0 ? (
        <div className="empty">No appointments scheduled.</div>
      ) : (
        sorted.map((e) => (
          <div key={e.id} className="ref-row">
            <div className="ref-time">{fmtTime(e.scheduled_start_time)}</div>
            <div className="ref-name">{e.patient_name}</div>
            <div className={`ref-dot ${dotClass(e)}`} />
          </div>
        ))
      )}
      <div className="muted" style={{ marginTop: 12, fontSize: 11 }}>
        Read-only reference. Any changes appear on the live timeline.
      </div>
    </aside>
  );
}
