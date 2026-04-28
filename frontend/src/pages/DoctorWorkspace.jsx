import { useState } from 'react';
import TopBar from '../components/TopBar.jsx';
import DoctorDashboardTab from '../components/doctor/DoctorDashboardTab.jsx';
import DoctorQueueTab from '../components/doctor/DoctorQueueTab.jsx';
import DoctorScheduleTab from '../components/doctor/DoctorScheduleTab.jsx';
import DoctorProfileTab from '../components/doctor/DoctorProfileTab.jsx';
import DoctorChatPanel from '../components/doctor/DoctorChatPanel.jsx';

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'queue',     label: "Today's Queue" },
  { key: 'schedule',  label: 'Schedule' },
  { key: 'profile',   label: 'My Profile' },
];

export default function DoctorWorkspace() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="app-shell">
      <TopBar tabs={TABS} activeTab={tab} onTabChange={setTab} />
      <div className="doctor-page">
        {tab === 'dashboard' && <DoctorDashboardTab onJump={setTab} />}
        {tab === 'queue'     && <DoctorQueueTab />}
        {tab === 'schedule'  && <DoctorScheduleTab />}
        {tab === 'profile'   && <DoctorProfileTab />}
      </div>
      <DoctorChatPanel />
    </div>
  );
}
