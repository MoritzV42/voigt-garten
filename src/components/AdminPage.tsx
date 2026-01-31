import { AuthProvider } from './AuthContext';
import AdminDashboard from './AdminDashboard';

export default function AdminPage() {
  return (
    <AuthProvider>
      <AdminDashboard />
    </AuthProvider>
  );
}
