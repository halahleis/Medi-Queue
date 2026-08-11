import LiveTrackerBanner from '../../components/patient/LiveTrackerBanner.jsx';

export default function LiveQueueTrackerPage() {
  return (
    <div className="patient-page">
      <div className="section-title">
        <h2>LIVE QUEUE <span style={{ color: 'var(--primary)' }}>TRACKER</span></h2>
        <p>Available on the same day as your appointment.</p>
      </div>
      <LiveTrackerBanner variant="page" />
    </div>
  );
}
