import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';

export default function AllDoctorsPage() {
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDept = searchParams.get('department') || '';

  const [departments, setDepartments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [departmentId, setDepartmentId] = useState(initialDept);
  const [loading, setLoading] = useState(true);

  // Load departments once.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/public/departments');
        setDepartments(data.departments);
      } catch { /* ignore */ }
    })();
  }, []);

  // Reload doctors whenever the department filter changes.
  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const { data } = await api.get('/public/doctors', {
          params: departmentId ? { departmentId } : {},
        });
        setDoctors(data.doctors);
      } catch { setDoctors([]); }
      finally { setLoading(false); }
    })();
    // Keep URL in sync so links are shareable.
    if (departmentId) setSearchParams({ department: departmentId });
    else setSearchParams({});
  }, [departmentId]);

  return (
    <div className="patient-page">
      <p className="muted" style={{ marginTop: 0 }}>Browse through the doctors specialist.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 24 }}>
        {/* Department filter sidebar */}
        <aside style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <FilterPill
            active={!departmentId}
            onClick={() => setDepartmentId('')}
            label="All specialities"
          />
          {departments.map((d) => (
            <FilterPill
              key={d.id}
              active={departmentId === d.id}
              onClick={() => setDepartmentId(d.id)}
              label={d.name}
            />
          ))}
        </aside>

        <section>
          {loading && <div className="empty">Loading doctors…</div>}
          {!loading && doctors.length === 0 && (
            <div className="empty">No doctors found in this speciality.</div>
          )}
          {!loading && doctors.length > 0 && (
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
          )}
        </section>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="btn"
      style={{
        justifyContent: 'flex-start',
        padding: '10px 16px',
        background: active ? 'var(--primary-light)' : 'var(--surface)',
        border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
        color: active ? 'var(--primary)' : 'var(--text)',
        borderRadius: 'var(--radius-sm)',
        textAlign: 'left',
        fontWeight: 400,
        fontSize: 13,
      }}
    >
      {label}
    </button>
  );
}
