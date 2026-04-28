import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import BookingModal from '../../components/patient/BookingModal.jsx';

const DAY_LABELS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAYS_AHEAD = 14;
const BOOKING_WINDOW_DAYS = 60;

export default function DoctorDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const [doctor, setDoctor] = useState(null);
  const [related, setRelated] = useState([]);
  const [activeDay, setActiveDay] = useState(0);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showBooking, setShowBooking] = useState(false);

  // Build a 14-day window of pickable dates starting today.
  const days = useMemo(() => {
    const out = [];
    const today = new Date();
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      out.push({
        date: d,
        iso: d.toISOString().slice(0, 10),
        dow: DAY_LABELS[d.getDay()],
        num: d.getDate(),
      });
    }
    return out;
  }, []);

  // Load doctor profile + related doctors.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [docRes, listRes] = await Promise.all([
          api.get(`/public/doctors/${id}`),
          api.get('/public/doctors'),
        ]);
        if (!active) return;
        setDoctor(docRes.data.doctor);
        setRelated(
          listRes.data.doctors
            .filter((d) => d.id !== id && d.specialty === docRes.data.doctor.specialty)
            .slice(0, 5)
        );
      } catch (err) {
        toast.error('Could not load doctor.');
      }
    })();
    return () => { active = false; };
  }, [id]);

  // Load slots for the selected day. Slots require login since they
  // disclose live queue state. Anonymous visitors see a CTA to sign in.
  useEffect(() => {
    if (!doctor) return;
    if (!user || user.role !== 'patient') {
      setSlots([]);
      return;
    }
    setSlotsLoading(true);
    setSelected(null);
    (async () => {
      try {
        const { data } = await api.get(`/patient/doctors/${doctor.id}/slots`, {
          params: { date: days[activeDay].iso },
        });
        setSlots(data.slots);
      } catch (err) {
        setSlots([]);
        toast.error(err.displayMessage || 'Could not load slots.');
      } finally {
        setSlotsLoading(false);
      }
    })();
  }, [doctor, activeDay, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const onBook = () => {
    if (!user || user.role !== 'patient') {
      toast('Please sign in to book an appointment.');
      nav('/login');
      return;
    }
    if (!selected) return;
    setShowBooking(true);
  };

  if (!doctor) {
    return <div className="patient-page"><div className="empty">Loading…</div></div>;
  }

  return (
    <div className="patient-page">
      <section className="doctor-detail">
        <div className="photo">👨‍⚕️</div>
        <div className="info-card">
          <h1>
            {doctor.full_name}
            <span className="verified" title="Verified">✓</span>
          </h1>
          <div className="qual">
            {doctor.qualifications || doctor.specialty}
            {doctor.specialty && ` • ${doctor.specialty}`}
            {doctor.department_name && ` • ${doctor.department_name}`}
          </div>
          <div className="bio-title">About</div>
          <div className="bio">
            {doctor.biography || 'This doctor has not added a biography yet.'}
          </div>
          <div className="fee">
            <span className="muted">Appointment fee: </span>
            <strong>${doctor.standard_fee}</strong>
            {doctor.followup_fee && (
              <span className="muted" style={{ marginLeft: 8 }}>
                (follow-up ${doctor.followup_fee})
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Day picker */}
      <section className="slots-section">
        <h3>Booking slots</h3>
        <div className="day-strip">
          {days.map((d, i) => (
            <button
              key={d.iso}
              className={`day-pill ${activeDay === i ? 'active' : ''}`}
              onClick={() => setActiveDay(i)}
              type="button"
            >
              <div className="dow">{d.dow}</div>
              <div className="num">{d.num}</div>
            </button>
          ))}
        </div>

        <div className="time-slot-row">
          {!user || user.role !== 'patient' ? (
            <div className="muted" style={{ fontSize: 13 }}>
              <button className="btn btn-outline btn-sm" onClick={() => nav('/login')}>
                Sign in to view available time slots
              </button>
            </div>
          ) : (
            <>
              {slotsLoading && <div className="muted" style={{ fontSize: 13 }}>Loading slots…</div>}
              {!slotsLoading && slots.length === 0 && (
                <div className="muted" style={{ fontSize: 13 }}>
                  No appointments available on this day.
                </div>
              )}
              {!slotsLoading && slots.map((s) => {
                const disabled = s.status !== 'available';
                const isSelected = selected
                  && selected.start_time === s.start_time
                  && selected.end_time === s.end_time;
                return (
                  <button
                    key={s.start_time}
                    className={`time-slot ${isSelected ? 'selected' : ''}`}
                    disabled={disabled}
                    onClick={() => setSelected(s)}
                    type="button"
                  >
                    {s.start_time.slice(0, 5)}
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-start' }}>
          <button
            className="btn btn-primary"
            disabled={!selected}
            onClick={onBook}
          >
            Book an appointment
          </button>
        </div>
      </section>

      {/* Related doctors */}
      {related.length > 0 && (
        <section style={{ marginTop: 48 }}>
          <div className="section-title">
            <h2>Related Doctors</h2>
            <p>Other specialists you may also consider.</p>
          </div>
          <div className="doctor-grid">
            {related.map((d) => (
              <div key={d.id} className="doctor-card" onClick={() => nav(`/doctors/${d.id}`)}>
                <div className="avatar-wrap">👨‍⚕️</div>
                <div className="body">
                  <div className="availability">Available</div>
                  <div className="name">{d.full_name}</div>
                  <div className="specialty">{d.specialty}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showBooking && selected && (
        <BookingModal
          doctor={doctor}
          slot={{ ...selected, date: days[activeDay].iso }}
          onClose={() => setShowBooking(false)}
          onConfirmed={() => {
            setShowBooking(false);
            setSelected(null);
            nav('/my-appointments');
          }}
        />
      )}
    </div>
  );
}
