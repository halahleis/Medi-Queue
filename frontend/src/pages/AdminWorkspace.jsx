import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../api/client';
import TopBar from '../components/TopBar.jsx';
import OverviewTab from '../components/admin/OverviewTab.jsx';
import DepartmentsTab from '../components/admin/DepartmentsTab.jsx';
import DoctorsTab from '../components/admin/DoctorsTab.jsx';
import StaffTab from '../components/admin/StaffTab.jsx';
import ReportsTab from '../components/admin/ReportsTab.jsx';

const TABS = [
  { key: 'overview',     label: 'Overview' },
  { key: 'departments',  label: 'Departments' },
  { key: 'doctors',      label: 'Doctors' },
  { key: 'staff',        label: 'Staff' },
  { key: 'reports',      label: 'Reports' },
];

export default function AdminWorkspace() {
  const [tab, setTab] = useState('overview');

  return (
    <div className="app-shell">
      <TopBar tabs={TABS} activeTab={tab} onTabChange={setTab} />
      <div className="admin-page">
        {tab === 'overview'    && <OverviewTab onJump={setTab} />}
        {tab === 'departments' && <DepartmentsTab />}
        {tab === 'doctors'     && <DoctorsTab />}
        {tab === 'staff'       && <StaffTab />}
        {tab === 'reports'     && <ReportsTab />}
      </div>
    </div>
  );
}
