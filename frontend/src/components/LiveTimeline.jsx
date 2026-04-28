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

/**
 * The heart of the staff view.
 *  - Shows hour rows from the doctor's working window.
 *  - Each queue entry gets an absolutely positioned card.
 *  - A live "NOW" line crosses the timeline.
 *  - Doctor unavailability shows as a striped blocked block.
 */
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

  // Tick the NOW line every minute.
  useEffect(() => {
    if (!isToday) return;
    const tick = () => setNowMin(timeToMin(nowTimeStr()));
    tick();
    const id = setInterval(tick, 30 * 1000);
    return () => clearInterval(id);
  }, [isToday]);

  // Determine the visible time window.
  let dayStart = 9 * 60;
  let dayEnd = 17 * 60;
  if (workingHours?.length) {
    dayStart = Math.min(...workingHours.map((w) => timeToMin(w.start_time)));
    dayEnd   = Math.max(...workingHours.map((w) => timeToMin(w.end_time)));
  }
  // Pad a little so cards near the edges aren't flush.
  dayStart = Math.max(0, dayStart - 30);
  dayEnd   = Math.min(24 * 60, dayEnd + 30);

  const totalMin = dayEnd - dayStart;
  const totalPx = totalMin * PX_PER_MIN;

  // Hours to render
  const hours = [];
  for (let m = Math.ceil(dayStart / 60) * 60; m <= dayEnd; m += 60) {
    hours.push(m);
  }

  // Position helpers
  const yOf = (min) => (min - dayStart) * PX_PER_MIN;

  return (
    <div className="timeline">
      <div className="timeline-header">
        <h3>Live Timeline</h3>
        <div className="muted" style={{ fontSize: 12 }}>
          {isToday ? `Now · ${fmtTime(nowTimeStr())}` : 'Historical view'}
        </div>
      </div>

      <div className="timeline-body" style={{ height: totalPx }}>
        {/* Hour markers (left labels + dashed top borders) */}
        {hours.map((m) => (
          <div key={m} className="timeline-hour" style={{ top: yOf(m) }}>
            {fmtTime(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)}
          </div>
        ))}

        {/* Blocked intervals (doctor unavailability) */}
        {blockedIntervals?.map((b, idx) => {
          const bs = b.is_full_day ? dayStart : timeToMin(b.block_start_time);
          const be = b.is_full_day ? dayEnd   : timeToMin(b.block_end_time);
          const top = Math.max(0, yOf(bs));
          const height = Math.max(20, (be - bs) * PX_PER_MIN);
          return (
            <div key={idx} className="tl-block" style={{ top, height }}>
              ⛔ Doctor Unavailable {b.reason ? `· ${b.reason}` : ''}
            </div>
          );
        })}

        {/* NOW line */}
        {isToday && nowMin >= dayStart && nowMin <= dayEnd && (
          <div className="now-line" style={{ top: yOf(nowMin) }} />
        )}

        {/* Cards
            Spec rules implemented here:
            1. Upcoming patients past scheduled+grace are removed from the grid
               (they appear in the kanban "Upcoming" column with a dynamic
               minutes-late label).
            2. Late patients who already checked in are also removed from the
               grid IF they are not yet on the live queue. Once staff clicks
               "Add to Live Schedule", the card reappears here pinned to the
               NOW delimiter, with its arrival-late label preserved.
            3. Cards sharing the same visible-start Y are laid out side-by-side
               in proper lanes (not cascaded), and shrink to keep readable
               widths as the stack grows. */}
        {(() => {
          const visible = entries
            .filter((e) => !['rejected', 'no_show'].includes(e.kanban_status))
            .filter((e) => {
              const onLive = e.position != null;
              // Late waiting patients hidden from the grid only until staff
              // adds them to the live queue.
              if (e.kanban_status === 'waiting' && e.arrival_tag === 'late' && !onLive) {
                return false;
              }
              // Upcoming patients past scheduled + grace: not yet arrived.
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

          // ────────────────────────────────────────────────────────────
          // Lane-assignment strategy
          //
          // Cards are split into two buckets:
          //
          //   1. FRONTIER cards: cards happening or pending at the NOW
          //      delimiter. Specifically, any waiting card on the live queue
          //      and any in-consultation card. These all share the same
          //      "lane group at NOW" and are laid out side-by-side, sorted
          //      stably by (scheduled_start_time, id) so a card stays in the
          //      same lane when it transitions from waiting → in
          //      consultation.
          //
          //   2. NON-FRONTIER cards: completed cards (rendered in their
          //      historical position) and upcoming cards before their
          //      scheduled time. These render full-width.
          //
          // This avoids the visual "jump" that happens when a card's vs
          // changes between two adjacent ticks — its lane membership is
          // determined by status, not by exact coordinates.
          // ────────────────────────────────────────────────────────────
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

          // Pixel constants (must agree with .timeline padding-left in CSS).
          const LEFT_GUTTER = 64;
          const RIGHT_PAD = 8;
          const LANE_GAP = 6;
          const MAX_W = 200;
          const MIN_W = 110;

          const out = [];

          // Render non-frontier cards: each takes the full available width
          // (capped at MAX_W) at its visible-start position.
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
                title="Click to view actions · Double-click to edit times"
              >
                <div className="tl-card-row">
                  <span className="tl-card-name">{e.patient_name}</span>
                  <span className="tl-card-time">
                    {fmtTime(minToTime(vs))}
                  </span>
                </div>
              </div>
            );
          }

          // Render frontier cards in side-by-side lanes. Each card keeps its
          // own vs/ve (so an in-consultation card extends from its actual
          // start down to NOW, while a waiting card sits at NOW), but lane
          // INDEX is determined by stable sort order — so a card never
          // visually jumps to a different lane when its status changes.
          const n = frontierCards.length;
          frontierCards.forEach(({ e, vs, ve }, idx) => {
            const top = yOf(vs);
            const height = Math.max(24, (ve - vs) * PX_PER_MIN);
            const isLate = e.arrival_tag === 'late';

            // Lateness uses the immutable ORIGINAL slot time, not the
            // (mutable, delay-shifted) scheduled_start_time on the queue
            // entry. This keeps "X min late" stable when delays are applied.
            let lateLabel = null;
            if (isLate && e.arrived_at) {
              const arrived = new Date(e.arrived_at);
              const arrivedMin =
                arrived.getHours() * 60 + arrived.getMinutes();
              const sched = timeToMin(
                e.original_scheduled_start || e.scheduled_start_time
              );
              const diff = Math.max(0, arrivedMin - sched);
              if (diff > 0) lateLabel = `${diff}m late`;
            }

            const laneStyle = {
              top,
              height,
              left: `calc(${LEFT_GUTTER}px + ${idx} * (min(${MAX_W}px, max(${MIN_W}px, (100% - ${LEFT_GUTTER + RIGHT_PAD}px - ${(n - 1) * LANE_GAP}px) / ${n})) + ${LANE_GAP}px))`,
              width: `min(${MAX_W}px, max(${MIN_W}px, calc((100% - ${LEFT_GUTTER + RIGHT_PAD}px - ${(n - 1) * LANE_GAP}px) / ${n})))`,
              zIndex: 3 + idx,
            };

            out.push(
              <div
                key={e.id}
                className={`tl-card ${e.kanban_status} ${isLate ? 'late-tag' : ''}`}
                style={laneStyle}
                onClick={() => onCardClick?.(e)}
                onDoubleClick={(ev) => {
                  ev.stopPropagation();
                  if (e.kanban_status === 'waiting' || e.kanban_status === 'in_consultation') {
                    setEditing(e);
                  }
                }}
                title="Click to view actions · Double-click to edit times"
              >
                <div className="tl-card-row">
                  <span className="tl-card-name">{e.patient_name}</span>
                  <span className="tl-card-time">
                    {fmtTime(minToTime(vs))}
                  </span>
                </div>
                {lateLabel && (
                  <div style={{ fontSize: 10, marginTop: 2, fontWeight: 600 }}>
                    ⚠ {lateLabel}
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