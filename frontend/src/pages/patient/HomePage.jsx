import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const SPECIALTY_ICONS = {
  Cardiology: '❤️',
  'General Medicine': '🩺',
  Dermatology: '🧴',
  Pediatrics: '👶',
  Neurology: '🧠',
  Gastroenterology: '🩻',
  Gynecology: '🌸',
  Ophthalmology: '👁️',
  ENT: '👂',
  Orthopedics: '🦴',
  Psychiatry: '🧘',
};

export default function HomePage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [dp, dr] = await Promise.all([
          api.get('/public/departments'),
          api.get('/public/doctors'),
        ]);
        setDepartments(dp.data.departments);
        setDoctors(dr.data.doctors.slice(0, 10));
      } catch (err) {
        // Silent fail — homepage degrades gracefully if backend is unreachable.
      }
    })();
  }, []);

  return (
    <div className="patient-page">
      <section className="hero">
        <div>
          <h1>Book Appointment<br />With Trusted Doctors</h1>
          <p>Browse our list of trusted doctors and schedule your appointment hassle-free.</p>
          <button
            className="btn"
            onClick={() => nav(user?.role === 'patient' ? '/doctors' : '/register')}
          >
            {user?.role === 'patient' ? 'Browse doctors →' : 'Get started →'}
          </button>
        </div>
        <div className="hero-illustration">🩺</div>
      </section>

      <section>
        <div className="section-title">
          <h2>Find by Speciality</h2>
          <p>Browse doctors by department and book in a few clicks.</p>
        </div>
        <div className="specialty-grid">
          {departments.map((d) => (
            <div
              key={d.id}
              className="specialty-card"
              onClick={() => nav(`/doctors?department=${d.id}`)}
            >
              <div className="icon">{SPECIALTY_ICONS[d.name] || '🩺'}</div>
              <div className="name">{d.name}</div>
            </div>
          ))}
          {departments.length === 0 && (
            <div className="empty" style={{ gridColumn: '1 / -1' }}>
              {user ? 'No departments available yet.' : 'Sign in to see available departments.'}
            </div>
          )}
        </div>
      </section>

      {doctors.length > 0 && (
        <section>
          <div className="section-title">
            <h2>Top Doctors to Book</h2>
            <p>A selection of trusted physicians available now.</p>
          </div>
          <div className="doctor-grid">
            {doctors.map((d) => (
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
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button className="btn btn-outline" onClick={() => nav('/doctors')}>more</button>
          </div>
        </section>
      )}
    </div>
  );
}
