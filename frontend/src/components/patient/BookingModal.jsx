import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import Modal from '../Modal.jsx';

/**
 * Booking confirmation modal.
 * Props:
 *   doctor       — doctor object
 *   slot         — { date, start_time, end_time }
 *   onClose()
 *   onConfirmed(appointmentId)
 *
 * Lifecycle:
 *   - On mount, places a 3-minute hold on the slot.
 *   - Shows a countdown; if it expires, the slot is released and the modal
 *     informs the user.
 *   - On confirm, books the appointment with selected payment method.
 *   - If the user closes/cancels mid-flow, releases the hold.
 */
export default function BookingModal({ doctor, slot, onClose, onConfirmed }) {
  const [holdSlotId, setHoldSlotId] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(180);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  // Place the hold on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.post('/patient/holds', {
          doctorId: doctor.id,
          date: slot.date,
          startTime: slot.start_time,
          endTime: slot.end_time,
        });
        if (cancelled) {
          // User closed before the hold returned — release immediately.
          api.delete(`/patient/holds/${data.slotId}`).catch(() => {});
          return;
        }
        setHoldSlotId(data.slotId);
        const expiresAt = new Date(data.expiresAt).getTime();
        const update = () => {
          const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
          setSecondsLeft(left);
          if (left === 0) setExpired(true);
        };
        update();
        const id = setInterval(update, 1000);
        return () => clearInterval(id);
      } catch (err) {
        toast.error(err.displayMessage || 'Could not reserve this slot.');
        onClose?.();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release the hold if the user closes the modal without confirming.
  const closeWithRelease = async () => {
    if (holdSlotId && !expired) {
      api.delete(`/patient/holds/${holdSlotId}`).catch(() => {});
    }
    onClose?.();
  };

  const confirm = async () => {
    if (!holdSlotId) return;
    setBusy(true);
    try {
      const { data } = await api.post('/patient/appointments', {
        slotId: holdSlotId,
        paymentMethod,
      });
      toast.success(
        data.visitType === 'follow_up'
          ? 'Follow-up appointment booked at the reduced fee.'
          : 'Appointment confirmed.'
      );
      // If they chose online, walk them through a fake payment immediately.
      if (paymentMethod === 'online') {
        await api.post(`/patient/appointments/${data.appointmentId}/pay`);
        toast.success('Payment received.');
      }
      onConfirmed?.(data.appointmentId);
    } catch (err) {
      toast.error(err.displayMessage || 'Booking failed.');
    } finally {
      setBusy(false);
    }
  };

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <Modal
      open
      onClose={closeWithRelease}
      title="Confirm your appointment"
      width={480}
      footer={
        <>
          <button className="btn btn-ghost" onClick={closeWithRelease}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy || expired || !holdSlotId}
            onClick={confirm}
          >
            {busy ? 'Booking…' : 'Confirm booking'}
          </button>
        </>
      }
    >
      <div className="col">
        <div className="card" style={{ padding: 14 }}>
          <div className="bold" style={{ fontSize: 15 }}>{doctor.full_name}</div>
          <div className="muted" style={{ fontSize: 13 }}>{doctor.specialty}</div>
          <div style={{ marginTop: 10, fontSize: 14 }}>
            <strong>{formatDate(slot.date)}</strong> at <strong>{slot.start_time.slice(0, 5)}</strong>
          </div>
        </div>

        {!expired ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted" style={{ fontSize: 12 }}>Slot held for:</span>
            <span className="hold-timer">
              {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </span>
          </div>
        ) : (
          <div className="card" style={{
            padding: 12,
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            fontSize: 13,
          }}>
            Your reservation expired. Please close this dialog and pick the slot again.
          </div>
        )}

        <div>
          <label className="label">Payment method</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <PayPill
              active={paymentMethod === 'cash'}
              onClick={() => setPaymentMethod('cash')}
              label="Pay at hospital"
              sub="Cash on arrival"
            />
            <PayPill
              active={paymentMethod === 'online'}
              onClick={() => setPaymentMethod('online')}
              label="Pay online"
              sub="Card (test mode)"
            />
          </div>
        </div>

        <div className="muted" style={{ fontSize: 12 }}>
          You can cancel this appointment up to 24 hours before the scheduled time.
        </div>
      </div>
    </Modal>
  );
}

function PayPill({ active, onClick, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '12px 14px',
        background: active ? 'var(--primary-light)' : 'var(--surface)',
        border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--primary)' : 'var(--text)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div className="bold" style={{ fontSize: 13 }}>{label}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>
    </button>
  );
}

function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
