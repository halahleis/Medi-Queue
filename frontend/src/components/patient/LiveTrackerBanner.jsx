import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { getSocket } from '../../api/socket';

/**
 * Live status banner shown at the top of MyAppointments.
 *
 * - Polls /patient/live-status on mount and on every `patient:status`
 *   socket event so updates feel instant.
 * - If the patient has an appointment today and they haven't arrived,
 *   shows a "Check in now" button.
 * - Once on the live queue, shows queue position and a 4-step progress bar.
 *
 * Renders nothing if the patient has no active appointment for today.
 */
export default function LiveTrackerBanner({ onChange }) {
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/patient/live-status');
      setActive(data.active);
    } catch (err) {
      // Silent; banner just won't render.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refetch on every patient:status event.
  useEffect(() => {
    const sock = getSocket();
    if (!sock) return;
    const onStatus = () => {
      load();
      onChange?.();   // also nudge the parent to refresh its appointment list
    };
    sock.on('patient:status', onStatus);
    return () => { sock.off('patient:status', onStatus); };
  }, [load, onChange]);

  if (loading || !active) return null;

  const handleCheckIn = async () => {
    setChecking(true);
    try {
      await api.post('/patient/check-in');
      toast.success('Checked in. Welcome!');
      await load();
      onChange?.();
    } catch (err) {
      toast.error(err.displayMessage || 'Could not check in.');
    } finally {
      setChecking(false);
    }
  };

  const stage = active.stage || 'pending';
  const stages = ['pending', 'waiting', 'in_consultation', 'completed'];
  const stageIndex = stages.indexOf(stage);

  // Top-line message + headline by stage.
  const headline = (() => {
    if (stage === 'pending')         return 'Your appointment is today';
    if (stage === 'waiting')         return 'You are in the waiting room';
    if (stage === 'in_consultation') return 'You are with the doctor';
    if (stage === 'completed')       return 'Your visit is complete';
    if (stage === 'rejected')        return 'Please speak to reception';
    return 'Live status';
  })();

  const subline = (() => {
    if (stage === 'pending') {
      return `${active.doctor_name} at ${active.start_time?.slice(0, 5)}. Tap below when you arrive at the clinic.`;
    }
    if (stage === 'waiting') {
      if (active.position == null) {
        return 'Waiting for staff to add you to the live queue.';
      }
      const ahead = active.ahead_count ?? 0;
      if (ahead === 0) return 'You are next.';
      if (ahead === 1) return '1 person ahead of you.';
      return `${ahead} people ahead of you.`;
    }
    if (stage === 'in_consultation') {
      return `Started at ${active.actual_start_time?.slice(0, 5)}. Please proceed to the consultation room.`;
    }
    if (stage === 'completed') {
      return 'Thank you. You can find your visit summary in your account.';
    }
    if (stage === 'rejected') {
      return 'Your appointment requires staff attention.';
    }
    return '';
  })();

  return (
    <div className="live-banner">
      <div className="label">Today's appointment</div>
      <h2>{headline}</h2>
      <div style={{ fontSize: 13, opacity: 0.9 }}>{subline}</div>

      {/* 4-step progress bar */}
      <div className="progress-bar">
        {stages.map((s, i) => (
          <div
            key={s}
            className={`progress-step ${i <= stageIndex ? 'done' : ''}`}
          />
        ))}
      </div>
      <div className="progress-labels">
        <span>Checked-In</span>
        <span>Waiting</span>
        <span>In Consultation</span>
        <span>Done</span>
      </div>

      {/* Check-in button — only visible before arrival */}
      {stage === 'pending' && (
        <div style={{ marginTop: 18 }}>
          <button
            className="btn"
            onClick={handleCheckIn}
            disabled={checking}
            style={{ background: 'white', color: 'var(--text)' }}
          >
            {checking ? 'Checking in…' : '📍 Check in now'}
          </button>
        </div>
      )}
    </div>
  );
}
