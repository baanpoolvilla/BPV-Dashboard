import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuthStore } from './store/auth';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
import EmployeePage from './pages/Employee/EmployeePage';

// The worksheet page pulls in the heavy BlockNote editor — load it on demand
// so the dashboard/employee pages stay light.
const WorksheetPage = lazy(() => import('./pages/Worksheet/WorksheetPage'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function RootRoute() {
  const user = useAuthStore(s => s.user);
  if (user?.role === 'CEO') return <DashboardPage />;
  if (user?.id) return <Navigate to={`/employees/${user.id}`} replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><RootRoute /></RequireAuth>} />
        <Route path="/employees/:userId" element={<RequireAuth><EmployeePage /></RequireAuth>} />
        <Route path="/employees/:userId/projects/:projectId/worksheet" element={<RequireAuth><Suspense fallback={null}><WorksheetPage /></Suspense></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
