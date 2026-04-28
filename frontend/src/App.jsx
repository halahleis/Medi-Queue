import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import StaffWorkspace from './pages/StaffWorkspace.jsx';
import AdminWorkspace from './pages/AdminWorkspace.jsx';
import PatientLayout from './pages/patient/PatientLayout.jsx';
import HomePage from './pages/patient/HomePage.jsx';
import AllDoctorsPage from './pages/patient/AllDoctorsPage.jsx';
import DoctorDetailPage from './pages/patient/DoctorDetailPage.jsx';
import MyAppointmentsPage from './pages/patient/MyAppointmentsPage.jsx';
import ProfilePage from './pages/patient/ProfilePage.jsx';
import AboutPage from './pages/patient/AboutPage.jsx';
import ContactPage from './pages/patient/ContactPage.jsx';

const RequireRole = ({ role, children }) => {
  const { user, token } = useAuth();
  if (!token || !user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/login" replace />;
  return children;
};

const HomeRedirect = () => {
  const { user } = useAuth();
  if (!user) return <Navigate to="/home" replace />;
  if (user.role === 'staff') return <Navigate to="/staff" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.role === 'patient') return <Navigate to="/home" replace />;
  return <Navigate to="/login" replace />;
};

export default function App() {
  return (
    <Routes>
      {/* Public auth pages */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Patient pages — public browsing allowed for Home/Doctors/About/Contact;
          booking + profile + appointments require login (handled inside the page) */}
      <Route element={<PatientLayout />}>
        <Route path="/home"           element={<HomePage />} />
        <Route path="/doctors"        element={<AllDoctorsPage />} />
        <Route path="/doctors/:id"    element={<DoctorDetailPage />} />
        <Route path="/about"          element={<AboutPage />} />
        <Route path="/contact"        element={<ContactPage />} />
        <Route
          path="/my-appointments"
          element={<RequireRole role="patient"><MyAppointmentsPage /></RequireRole>}
        />
        <Route
          path="/profile"
          element={<RequireRole role="patient"><ProfilePage /></RequireRole>}
        />
      </Route>

      <Route
        path="/staff/*"
        element={<RequireRole role="staff"><StaffWorkspace /></RequireRole>}
      />
      <Route
        path="/admin/*"
        element={<RequireRole role="admin"><AdminWorkspace /></RequireRole>}
      />

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
