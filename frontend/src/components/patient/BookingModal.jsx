import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import Modal from '../Modal.jsx';
import PaymentModal from './PaymentModal.jsx';

/**
 * Booking confirmation modal.
 * Props:
 *   doctor       - doctor object
 *   slot         - { date, start_time, end_time }
 *   onClose()
 *   onConfirmed(appointmentId)
 */
export default function BookingModal({ doctor, slot, onClose, onConfirmed }) {
  const [holdSlotId, setHoldSlotId] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(180);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [paymentAppointment, setPaymentAppointment] = useState(null);

  const holdInFlight = useRef(false);
  const holdSlotIdRef = useRef(null);

  useEffect(() => {
    if (holdInFlight.current) return;
    holdInFlight.current = true;

    let intervalId;
    (async () => {
      try {
        const { data } = await api.post('/patient/holds', {
          doctorId: doctor.id,
          date: slot.date,
          startTime: slot.start_time,
          endTime: slot.end_time,
        });
        setHoldSlotId(data.slotId);
        holdSlotIdRef.current = data.slotId;
        const expiresAt = new Date(data.expiresAt).getTime();
        const update = () => {
          const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
          setSecondsLeft(left);
          if (left === 0) setExpired(true);
        };
        update();
        intervalId = setInterval(update, 1000);
      } catch (err) {
        toast.error(err.displayMessage || 'Could not reserve this slot.');
        onClose?.();
      }
    })();

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeWithRelease = async () => {
    const id = holdSlotIdRef.current;
    if (id && !expired) {
      api.delete(`/patient/holds/${id}`).catch(() => {});
    }
    holdSlotIdRef.current = null;
    onClose?.();
  };

  const confirm = async () => {
    const id = holdSlotIdRef.current || holdSlotId;
    if (!id) return;
    setBusy(true);
    try {
      const { data } = await api.post('/patient/appointments', {
        slotId: id,
        paymentMethod,
      });
      holdSlotIdRef.current = null;
      toast.success(
        data.visitType === 'follow_up'
          ? 'Follow-up appointment booked at the reduced fee.'
          : 'Appointment confirmed.'
      );

      if (paymentMethod === 'online') {
        setPaymentAppointment({
          id: data.appointmentId,
          fee_charged: data.fee,
        });
        return;
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
    <>
      <Modal
        open={!paymentAppointment}
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
              {busy ? 'Booking...' : 'Confirm booking'}
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
                sub="Stripe options"
              />
            </div>
          </div>

          <div className="muted" style={{ fontSize: 12 }}>
            You can cancel this appointment up to 24 hours before the scheduled time.
          </div>
        </div>
      </Modal>

      {paymentAppointment && (
        <PaymentModal
          appointment={paymentAppointment}
          amount={paymentAppointment.fee_charged}
          onClose={() => onConfirmed?.(paymentAppointment.id)}
          onPaid={() => {
            toast.success('Payment received.');
            onConfirmed?.(paymentAppointment.id);
          }}
        />
      )}
    </>
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
