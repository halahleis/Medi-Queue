export default function AboutPage() {
  return (
    <div className="patient-page">
      <div className="section-title">
        <h2>ABOUT <span style={{ color: 'var(--primary)' }}>US</span></h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 32, marginBottom: 40 }}>
        <div style={{
          background: 'var(--primary-light)',
          height: 280,
          borderRadius: 'var(--radius)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 100, color: 'var(--primary)',
        }}>
          🏥
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--text)' }}>
          <p>
            Welcome to MediQueue, your trusted partner in managing your healthcare needs
            conveniently and efficiently. At MediQueue, we understand the challenges
            individuals face when it comes to scheduling doctor appointments and
            tracking their place in line.
          </p>
          <p>
            MediQueue is committed to excellence in healthcare technology. We continuously
            strive to enhance our platform, integrating the latest advancements to improve
            user experience and deliver superior service. Whether you're booking your first
            appointment or managing ongoing care, MediQueue is here to support you every step
            of the way.
          </p>

          <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 24, marginBottom: 6 }}>Our Vision</h3>
          <p style={{ marginTop: 0 }}>
            Our vision at MediQueue is to create a seamless healthcare experience for every
            user. We aim to bridge the gap between patients and healthcare providers, making
            it easier for you to access the care you need, when you need it.
          </p>
        </div>
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 600, margin: '40px 0 18px' }}>
        WHY <span style={{ color: 'var(--primary)' }}>CHOOSE US</span>
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <ValueCard title="EFFICIENCY" body="Streamlined appointment scheduling that fits into your busy lifestyle." />
        <ValueCard title="CONVENIENCE" body="Access to a network of trusted healthcare professionals in your area." />
        <ValueCard title="LIVE QUEUE TRACKING" body="See exactly where you stand in line and what time you'll be seen." />
      </div>
    </div>
  );
}

function ValueCard({ title, body }) {
  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 style={{
        fontSize: 13, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.04em',
        margin: 0, marginBottom: 12,
      }}>
        {title}
      </h3>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
        {body}
      </p>
    </div>
  );
}
