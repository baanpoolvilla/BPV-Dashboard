import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
import EmployeePage from './pages/Employee/EmployeePage';
import WorksheetPage from './pages/Worksheet/WorksheetPage';

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
        <Route path="/employees/:userId/projects/:projectId/worksheet" element={<RequireAuth><WorksheetPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
