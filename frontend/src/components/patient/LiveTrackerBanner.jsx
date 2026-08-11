import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';
import { getSocket } from '../../api/socket';

export default function LiveTrackerBanner({ onChange, variant = 'banner' }) {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/patient/live-status');
      setAppointments(data.appointments || (data.active ? [data.active] : []));
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const onStatus = () => {
      load();
      onChange?.();
    };
    sock.on('patient:status', onStatus);
    return () => { sock.off('patient:status', onStatus); };
  }, [load, onChange]);

  if (loading) return <div className="empty">Loading live queue...</div>;
  if (appointments.length === 0) {
    if (variant === 'page') {
      return <div className="empty">The live queue tracker is available only on the same day as an active appointment.</div>;
    }
    return null;
  }

  return (
    <div className="live-tracker-list">
      {appointments.map((appointment) => (
        <TrackerCard
          key={appointment.appointment_id}
          active={appointment}
          variant={variant}
        />
      ))}
    </div>
  );
}

function TrackerCard({ active, variant }) {
  const stage = active.stage || 'pending';
  const trackerPaused = stage === 'too_late' || (active.arrival_tag === 'late' && active.position == null);
  const stages = ['checked_in', 'waiting', 'in_consultation', 'completed'];
  const stageIndex = stages.indexOf(stage);

  const headline = (() => {
    if (trackerPaused) return 'Your live tracker is paused';
    if (stage === 'pending') return 'Not checked in yet';
    if (stage === 'checked_in') return 'You are checked in';
    if (stage === 'waiting') return 'You are in the waiting room';
    if (stage === 'in_consultation') return 'You are with the doctor';
    if (stage === 'completed') return 'Your visit is complete';
    if (stage === 'rejected') return 'Please speak to reception';
    return 'Live status';
  })();

  const queueText = (() => {
    if (stage === 'completed') return 'Visit completed';
    if (stage === 'in_consultation') return 'You are first in this doctor queue';
    const ahead = active.ahead_count ?? 0;
    if (ahead === 0) return 'You are next in this doctor queue';
    if (ahead === 1) return 'There is 1 person ahead of you';
    return `There are ${ahead} people ahead of you`;
  })();

  const timeMetric = (() => {
    if (stage === 'completed') {
      return {
        label: 'End time',
        value: active.actual_end_time || active.consultation_end_at,
      };
    }
    if (stage === 'in_consultation') {
      return {
        label: 'Start time',
        value: active.actual_start_time,
      };
    }
    return {
      label: 'Estimated start',
      value: active.estimated_start_time || active.scheduled_start_time || active.start_time,
    };
  })();

  const subline = (() => {
    if (trackerPaused) {
      return 'You arrived after your scheduled time. Contact staff to see if you can be fit into another position today.';
    }
    if (stage === 'pending') {
      return 'Staff will check you in when you arrive. Your queue estimate is visible before arrival.';
    }
    if (stage === 'checked_in') {
      return 'Staff checked you in. Waiting for placement in the live queue.';
    }
    if (stage === 'waiting') return queueText;
    if (stage === 'in_consultation') {
      return `Started at ${formatTime(active.actual_start_time)}. Please proceed to the consultation room.`;
    }
    if (stage === 'completed') return 'Thank you. You can find your visit summary in your account.';
    return '';
  })();

  return (
    <div className={`live-banner ${variant === 'page' ? 'live-banner-page' : ''}`}>
      <div className="label">Live Queue Tracker</div>
      <h2>{active.doctor_name}</h2>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{headline}</div>
      <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>{subline}</div>

      {!trackerPaused && (
        <div className="live-tracker-details">
          <div>
            <span>Queue position</span>
            <strong>{queueText}</strong>
          </div>
          <div>
            <span>{timeMetric.label}</span>
            <strong>{formatTime(timeMetric.value)}</strong>
          </div>
        </div>
      )}

      {!trackerPaused && (
        <>
          <div className="progress-bar">
            {stages.map((s, i) => (
              <div
                key={s}
                className={`progress-step ${stageIndex >= 0 && i <= stageIndex ? 'done' : ''}`}
              />
            ))}
          </div>
          <div className="progress-labels">
            <span>Checked In</span>
            <span>Waiting</span>
            <span>In Consultation</span>
            <span>Done</span>
          </div>
        </>
      )}
    </div>
  );
}

function formatTime(value) {
  if (!value) return 'Not available';
  if (String(value).includes('T')) {
    const dateValue = new Date(value);
    if (!Number.isNaN(dateValue.getTime())) {
      return dateValue.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  const [h, m] = String(value).split(':').map(Number);
  const date = new Date();
  date.setHours(h || 0, m || 0, 0, 0);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
