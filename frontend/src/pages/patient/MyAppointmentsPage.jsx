import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/client';
import PaymentModal from '../../components/patient/PaymentModal.jsx';

export default function MyAppointmentsPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paymentAppointment, setPaymentAppointment] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/patient/appointments');
      setItems(data.appointments);
    } catch (err) {
      toast.error(err.displayMessage || 'Could not load your appointments.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCancel = async (appt) => {
    if (!window.confirm('Cancel this appointment? Cancellations must be made at least 24 hours before the scheduled time.')) {
      return;
    }
    try {
      await api.post(`/patient/appointments/${appt.id}/cancel`);
      toast.success('Appointment cancelled.');
      load();
    } catch (err) {
      toast.error(err.displayMessage || 'Could not cancel.');
    }
  };

  const handlePay = (appt) => setPaymentAppointment(appt);

  return (
    <div className="patient-page">
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 18 }}>My Appointments</h2>

      {loading && <div className="empty">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="empty">You haven't booked any appointments yet.</div>
      )}

      <div className="appt-list">
        {items.map((a) => (
          <ApptCard
            key={a.id}
            appt={a}
            onCancel={() => handleCancel(a)}
            onPay={() => handlePay(a)}
          />
        ))}
      </div>

      {paymentAppointment && (
        <PaymentModal
          appointment={paymentAppointment}
          amount={paymentAppointment.fee_charged}
          onClose={() => setPaymentAppointment(null)}
          onPaid={() => {
            toast.success('Payment received.');
            setPaymentAppointment(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ApptCard({ appt, onCancel, onPay }) {
  const dateStr = formatAppointmentDate(appt.slot_date || appt.scheduled_at);
  const time = (appt.start_time || '').slice(0, 5) || formatAppointmentTime(appt.scheduled_at);

  // 24h cancellation rule (frontend hint — server enforces too).
  const hoursAhead = (new Date(appt.scheduled_at) - new Date()) / (1000 * 60 * 60);
  const canCancel =
    !['completed', 'cancelled', 'no_show'].includes(appt.status) && hoursAhead >= 24;

  // Show cancel only if technically allowed; show pay only if not paid + not cancelled.
  const isUnpaid = appt.payment_status === 'unpaid';
  const showPay = isUnpaid && appt.status !== 'cancelled' && appt.status !== 'completed';

  return (
    <div className="appt-card">
      <div className="photo">👨‍⚕️</div>
      <div className="info">
        <div className="doc-name">{appt.doctor_name}</div>
        <div className="specialty">{appt.specialty}</div>
        {appt.department_name && (
          <div className="muted" style={{ fontSize: 12 }}>{appt.department_name}</div>
        )}
        <div className="when">
          <strong>Date & Time:</strong> {dateStr} at {time}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <StatusBadge status={appt.status} />
          <PaymentBadge status={appt.payment_status} />
          {appt.visit_type === 'follow_up' && (
            <span className="badge badge-info">Follow-up</span>
          )}
          {appt.kanban_status === 'waiting' && appt.position && (
            <span className="badge badge-success">In live queue · #{appt.position}</span>
          )}
          {appt.kanban_status === 'in_consultation' && (
            <span className="badge badge-success">With the doctor now</span>
          )}
          {appt.kanban_status === 'completed' && (
            <span className="badge badge-muted">Visit completed</span>
          )}
        </div>
      </div>
      <div className="actions">
        {showPay && (
          <button className="btn btn-primary btn-sm" onClick={onPay}>
            Pay ${appt.fee_charged}
          </button>
        )}
        {appt.payment_status === 'online_paid' && (
          <span className="badge badge-success" style={{ padding: '6px 14px' }}>Paid</span>
        )}
        {canCancel && (
          <button className="btn btn-outline btn-sm" onClick={onCancel}>
            Cancel appointment
          </button>
        )}
        {!canCancel && appt.status === 'confirmed' && hoursAhead < 24 && hoursAhead > 0 && (
          <span className="muted" style={{ fontSize: 11, textAlign: 'right' }}>
            Cancellation window closed
          </span>
        )}
      </div>
    </div>
  );
}

function formatAppointmentDate(value) {
  if (!value) return 'Date unavailable';
  const raw = String(value);
  const datePart = raw.includes('T') ? raw.slice(0, 10) : raw.slice(0, 10);
  const date = new Date(`${datePart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatAppointmentTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }) {
  const map = {
    confirmed:        ['badge-success', 'Confirmed'],
    pending_payment:  ['badge-warning', 'Pending payment'],
    completed:        ['badge-muted',   'Completed'],
    cancelled:        ['badge-danger',  'Cancelled'],
    no_show:          ['badge-warning', 'No-show'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function PaymentBadge({ status }) {
  const map = {
    unpaid:      ['badge-warning', 'Unpaid'],
    online_paid: ['badge-success', 'Paid online'],
    cash_paid:   ['badge-success', 'Paid'],
    refunded:    ['badge-info',    'Refunded'],
  };
  const [cls, label] = map[status] || ['badge-muted', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
