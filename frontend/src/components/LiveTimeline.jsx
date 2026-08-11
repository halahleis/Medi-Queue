import { useState, useEffect } from 'react';
import {
  PX_PER_MIN,
  LATE_GRACE_MIN,
  fmtTime,
  timeToMin,
  minToTime,
  nowTimeStr,
  computeVisibleStart,
  computeVisibleEnd,
} from '../utils/time';
import UpdateTimesModal from './UpdateTimesModal.jsx';

export default function LiveTimeline({
  entries,
  workingHours,
  blockedIntervals,
  onTimesUpdate,
  onCardClick,
  isToday,
}) {
  const [nowMin, setNowMin] = useState(timeToMin(nowTimeStr()));
  const [editing, setEditing] = useState(null);

  useEffect(() => {
    if (!isToday) return;
    const tick = () => setNowMin(timeToMin(nowTimeStr()));
    tick();
    const id = setInterval(tick, 30 * 1000);
    return () => clearInterval(id);
  }, [isToday]);

  let dayStart = 9 * 60;
  let dayEnd = 17 * 60;
  if (workingHours?.length) {
    dayStart = Math.min(...workingHours.map((w) => timeToMin(w.start_time)));
    dayEnd = Math.max(...workingHours.map((w) => timeToMin(w.end_time)));
  }
  dayStart = Math.max(0, dayStart - 30);
  dayEnd = Math.min(24 * 60, dayEnd + 30);

  const totalMin = dayEnd - dayStart;
  const totalPx = totalMin * PX_PER_MIN;

  const hours = [];
  for (let m = Math.ceil(dayStart / 60) * 60; m <= dayEnd; m += 60) {
    hours.push(m);
  }

  const yOf = (min) => (min - dayStart) * PX_PER_MIN;

  return (
    <div className="timeline">
      <div className="timeline-header">
        <h3>Live Timeline</h3>
        <div className="muted" style={{ fontSize: 12 }}>
          {isToday ? `Now - ${fmtTime(nowTimeStr())}` : 'Historical view'}
        </div>
      </div>

      <div className="timeline-body" style={{ height: totalPx }}>
        {hours.map((m) => (
          <div key={m} className="timeline-hour" style={{ top: yOf(m) }}>
            {fmtTime(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)}
          </div>
        ))}

        {blockedIntervals?.map((b, idx) => {
          const bs = b.is_full_day ? dayStart : timeToMin(b.block_start_time);
          const be = b.is_full_day ? dayEnd : timeToMin(b.block_end_time);
          const top = Math.max(0, yOf(bs));
          const height = Math.max(20, (be - bs) * PX_PER_MIN);
          return (
            <div key={idx} className="tl-block" style={{ top, height }}>
              Doctor unavailable {b.reason ? `- ${b.reason}` : ''}
            </div>
          );
        })}

        {isToday && nowMin >= dayStart && nowMin <= dayEnd && (
          <div className="now-line" style={{ top: yOf(nowMin) }} />
        )}

        {(() => {
          const visible = entries
            .filter((e) => !['rejected', 'no_show'].includes(e.kanban_status))
            .filter((e) => {
              const onLive = e.position != null;
              if (e.kanban_status === 'waiting' && e.arrival_tag === 'late' && !onLive) {
                return false;
              }
              if (e.kanban_status === 'upcoming' && isToday) {
                const sched = timeToMin(e.scheduled_start_time);
                if (nowMin - sched > LATE_GRACE_MIN) return false;
              }
              return true;
            })
            .map((e) => {
              const vs = computeVisibleStart(e, nowMin);
              const ve = computeVisibleEnd(e, nowMin, vs);
              return { e, vs, ve };
            });

          const isFrontier = (c) =>
            c.e.kanban_status === 'in_consultation' ||
            (c.e.kanban_status === 'waiting' && c.e.position != null);

          const frontierCards = visible
            .filter(isFrontier)
            .sort((a, b) => {
              const aS = timeToMin(a.e.scheduled_start_time);
              const bS = timeToMin(b.e.scheduled_start_time);
              if (aS !== bS) return aS - bS;
              return String(a.e.id).localeCompare(String(b.e.id));
            });

          const nonFrontierCards = visible
            .filter((c) => !isFrontier(c))
            .sort((a, b) => a.vs - b.vs);

          const LEFT_GUTTER = 64;
          const RIGHT_PAD = 8;
          const LANE_GAP = 6;
          const MAX_W = 200;
          const MIN_W = 110;
          const out = [];

          for (const { e, vs, ve } of nonFrontierCards) {
            const top = yOf(vs);
            const height = Math.max(24, (ve - vs) * PX_PER_MIN);
            const isLate = e.arrival_tag === 'late';

            out.push(
              <div
                key={e.id}
                className={`tl-card ${e.kanban_status} ${isLate ? 'late-tag' : ''}`}
                style={{
                  top,
                  height,
                  left: `${LEFT_GUTTER}px`,
                  width: `min(${MAX_W}px, calc(100% - ${LEFT_GUTTER + RIGHT_PAD}px))`,
                }}
                onClick={() => onCardClick?.(e)}
                onDoubleClick={(ev) => {
                  ev.stopPropagation();
                  if (['upcoming'].includes(e.kanban_status)) {
                    setEditing(e);
                  }
                }}
                title="Click to view actions - Double-click to edit times"
              >
                <div className="tl-card-row">
                  <span className="tl-card-name">{e.patient_name}</span>
                  <span className="tl-card-time">{fmtTime(minToTime(vs))}</span>
                </div>
              </div>
            );
          }

          const n = frontierCards.length;
          frontierCards.forEach(({ e, vs, ve }, idx) => {
            const top = yOf(vs);
            const height = Math.max(24, (ve - vs) * PX_PER_MIN);
            const isLate = e.arrival_tag === 'late';
            let lateLabel = null;

            if (isLate && e.arrived_at) {
              const arrived = new Date(e.arrived_at);
              const arrivedMin = arrived.getHours() * 60 + arrived.getMinutes();
              const sched = timeToMin(e.original_scheduled_start || e.scheduled_start_time);
              const diff = Math.max(0, arrivedMin - sched);
              if (diff > 0) lateLabel = `${diff}m late`;
            }

            out.push(
              <div
                key={e.id}
                className={`tl-card ${e.kanban_status} ${isLate ? 'late-tag' : ''}`}
                style={{
                  top,
                  height,
                  left: `calc(${LEFT_GUTTER}px + ${idx} * (min(${MAX_W}px, max(${MIN_W}px, (100% - ${LEFT_GUTTER + RIGHT_PAD}px - ${(n - 1) * LANE_GAP}px) / ${n})) + ${LANE_GAP}px))`,
                  width: `min(${MAX_W}px, max(${MIN_W}px, calc((100% - ${LEFT_GUTTER + RIGHT_PAD}px - ${(n - 1) * LANE_GAP}px) / ${n})))`,
                  zIndex: 3 + idx,
                }}
                onClick={() => onCardClick?.(e)}
                onDoubleClick={(ev) => {
                  ev.stopPropagation();
                  if (e.kanban_status === 'waiting' || e.kanban_status === 'in_consultation') {
                    setEditing(e);
                  }
                }}
                title="Click to view actions - Double-click to edit times"
              >
                <div className="tl-card-row">
                  <span className="tl-card-name">{e.patient_name}</span>
                  <span className="tl-card-time">{fmtTime(minToTime(vs))}</span>
                </div>
                {lateLabel && (
                  <div style={{ fontSize: 10, marginTop: 2, fontWeight: 600 }}>
                    {lateLabel}
                  </div>
                )}
              </div>
            );
          });

          return out;
        })()}
      </div>

      <UpdateTimesModal
        entry={editing}
        onClose={() => setEditing(null)}
        onSave={async (start, end) => {
          await onTimesUpdate?.(editing.id, start, end);
          setEditing(null);
        }}
      />
    </div>
  );
}
