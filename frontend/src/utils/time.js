// Pixels per minute on the timeline. 60 px/hour.
export const PX_PER_MIN = 1;

// Minutes past scheduled time before a patient is considered "late".
// Must match the backend's LATE_GRACE_MIN in queueService.js.
export const LATE_GRACE_MIN = 10;

export const todayStr = () => {
  const d = new Date();
  return [d.getFullYear(),
          String(d.getMonth() + 1).padStart(2, '0'),
          String(d.getDate()).padStart(2, '0')].join('-');
};

export const nowTimeStr = () => {
  const d = new Date();
  return [d.getHours(), d.getMinutes()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':') + ':00';
};

export const timeToMin = (t) => {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const minToTime = (m) => {
  const mm = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return [
    String(Math.floor(mm / 60)).padStart(2, '0'),
    String(mm % 60).padStart(2, '0'),
  ].join(':') + ':00';
};

export const fmtTime = (t) => {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Compute the *visible* start used to position a card on the timeline.
 *
 * Rules:
 *   - completed: anchored at actual_start_time (its true historical position)
 *   - in_consultation: actual_start_time, but clamped so it never appears
 *     below the NOW line. If actual_start happens to be slightly after nowMin
 *     (the NOW tick lags reality by up to 30s), we snap vs to nowMin so the
 *     card stays at the delimiter rather than dangling below it.
 *   - upcoming/waiting: max(scheduled_start, now) — they cannot remain
 *     stranded before NOW.
 */
export const computeVisibleStart = (entry, nowMin) => {
  if (entry.kanban_status === 'completed') {
    return timeToMin(entry.actual_start_time || entry.scheduled_start_time);
  }
  if (entry.kanban_status === 'in_consultation') {
    const actual = timeToMin(entry.actual_start_time || entry.scheduled_start_time);
    return Math.min(actual, nowMin);
  }
  const sched = timeToMin(entry.scheduled_start_time);
  return Math.max(sched, nowMin);
};

/**
 * Compute the *visible* end of a card.
 *
 * Rules:
 *   - completed: anchored at actual_end_time
 *   - in_consultation: extends from vs down to NOW (or scheduled_end if
 *     somehow later), with a small minimum height so the card is always
 *     visible even right after admission.
 *   - upcoming/waiting: vs + scheduled_duration (so they keep their length).
 */
export const computeVisibleEnd = (entry, nowMin, visibleStart) => {
  if (entry.kanban_status === 'completed') {
    return timeToMin(entry.actual_end_time || entry.scheduled_end_time);
  }
  if (entry.kanban_status === 'in_consultation') {
    const sched = timeToMin(entry.scheduled_end_time);
    // Always at least 5 min tall so a freshly admitted card is visible at NOW.
    return Math.max(visibleStart + 5, nowMin, sched);
  }
  const sched = timeToMin(entry.scheduled_end_time);
  const duration = sched - timeToMin(entry.scheduled_start_time);
  return visibleStart + duration;
};