export default function ContactPage() {
  return (
    <div className="patient-page">
      <div className="section-title">
        <h2>CONTACT <span style={{ color: 'var(--primary)' }}>US</span></h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 32 }}>
        <div style={{
          background: 'var(--primary-light)',
          height: 320,
          borderRadius: 'var(--radius)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 120, color: 'var(--primary)',
        }}>
          🏨
        </div>

        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 12px' }}>
            Our Office
          </h3>
          <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-muted)', margin: 0 }}>
            54709 Willms Station<br />
            Suite 350, Washington, USA<br /><br />
            Tel: (415) 555-0132<br />
            Email: contact@mediqueue.test
          </p>

          <h3 style={{ fontSize: 14, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '32px 0 12px' }}>
            Careers at MediQueue
          </h3>
          <p style={{ fontSize: 13.5, color: 'var(--text-muted)', margin: '0 0 14px' }}>
            Learn more about our teams and job openings.
          </p>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => alert('Careers portal coming soon.')}
          >
            Explore Jobs
          </button>
        </div>
      </div>
    </div>
  );
}
