import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';

interface Stats {
  pendingBookings: number;
  unconfirmedCompletions: number;
  totalCreditsAwarded: number;
  projectsByStatus: Record<string, number>;
}

interface Project {
  id: number;
  title: string;
  description: string | null;
  category: string;
  status: string;
  priority: string;
  estimated_cost: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completion_photo: string | null;
  completion_notes: string | null;
  confirmed_at: string | null;
  credit_awarded: number | null;
}

interface Booking {
  id: number;
  guest_name: string;
  guest_email: string;
  guest_phone: string | null;
  check_in: string;
  check_out: string;
  guests: number;
  total_price: number;
  status: string;
  created_at: string;
  notes: string | null;
}

interface User {
  id: number;
  email: string;
  username: string;
  name: string | null;
  role: string;
  last_login: string | null;
  created_at: string;
}

type Tab = 'dashboard' | 'bookings' | 'projects' | 'users';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5055' : '';

export default function AdminDashboard() {
  const { user, token, isAdmin, logout } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<Stats | null>(null);
  const [pendingProjects, setPendingProjects] = useState<Project[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch data when user is admin
  useEffect(() => {
    if (isAdmin && token) {
      fetchAllData();
    } else {
      setIsLoading(false);
    }
  }, [isAdmin, token]);

  const fetchAllData = async () => {
    setIsLoading(true);
    await Promise.all([
      fetchStats(),
      fetchPendingProjects(),
      fetchBookings(),
      fetchUsers()
    ]);
    setIsLoading(false);
  };

  const fetchStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  const fetchPendingProjects = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/pending-confirmations`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setPendingProjects(data.projects || []);
      }
    } catch (error) {
      console.error('Failed to fetch pending projects:', error);
    }
  };

  const fetchBookings = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/bookings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setBookings(data.bookings || []);
      }
    } catch (error) {
      console.error('Failed to fetch bookings:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const confirmProject = async (projectId: number, creditAmount: number) => {
    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ creditAmount })
      });

      if (response.ok) {
        await fetchAllData();
      }
    } catch (error) {
      console.error('Failed to confirm project:', error);
    }
  };

  const updateBookingStatus = async (bookingId: number, status: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status })
      });

      if (response.ok) {
        await fetchBookings();
      }
    } catch (error) {
      console.error('Failed to update booking:', error);
    }
  };

  const updateUserRole = async (userId: number, role: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role })
      });

      if (response.ok) {
        await fetchUsers();
      }
    } catch (error) {
      console.error('Failed to update user:', error);
    }
  };

  // Not logged in
  if (!user) {
    return (
      <div className="max-w-4xl mx-auto text-center py-12">
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Admin-Bereich</h2>
          <p className="text-gray-600 mb-6">Bitte melde dich an, um auf den Admin-Bereich zuzugreifen.</p>
          <button
            onClick={() => setShowLoginModal(true)}
            className="bg-garden-600 hover:bg-garden-700 text-white px-6 py-3 rounded-lg font-medium"
          >
            🔐 Anmelden
          </button>
        </div>
        <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </div>
    );
  }

  // Not admin
  if (!isAdmin) {
    return (
      <div className="max-w-4xl mx-auto text-center py-12">
        <div className="bg-red-50 rounded-xl p-8">
          <h2 className="text-2xl font-bold text-red-800 mb-4">Zugriff verweigert</h2>
          <p className="text-red-600 mb-4">
            Du bist eingeloggt als <strong>{user.email}</strong>, aber du hast keine Admin-Berechtigung.
          </p>
          <button
            onClick={logout}
            className="text-red-700 hover:text-red-900 underline"
          >
            Mit anderem Account anmelden
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-garden-600"></div>
      </div>
    );
  }

  // Dashboard Tab
  const DashboardTab = () => (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-amber-50 rounded-xl p-6">
          <div className="text-3xl font-bold text-amber-600">{stats?.pendingBookings || 0}</div>
          <div className="text-sm text-amber-700">Offene Buchungen</div>
        </div>
        <div className="bg-blue-50 rounded-xl p-6">
          <div className="text-3xl font-bold text-blue-600">{stats?.unconfirmedCompletions || 0}</div>
          <div className="text-sm text-blue-700">Unbestätigte Erledigungen</div>
        </div>
        <div className="bg-green-50 rounded-xl p-6">
          <div className="text-3xl font-bold text-green-600">{stats?.totalCreditsAwarded?.toFixed(0) || 0}€</div>
          <div className="text-sm text-green-700">Vergebene Credits</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-6">
          <div className="text-3xl font-bold text-purple-600">{users.length}</div>
          <div className="text-sm text-purple-700">Registrierte User</div>
        </div>
      </div>

      {/* Pending Confirmations */}
      {pendingProjects.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="font-bold text-xl text-gray-800 mb-4">
            ⏳ Unbestätigte Erledigungen ({pendingProjects.length})
          </h3>
          <div className="space-y-4">
            {pendingProjects.slice(0, 5).map(project => (
              <PendingProjectCard key={project.id} project={project} onConfirm={confirmProject} />
            ))}
            {pendingProjects.length > 5 && (
              <button
                onClick={() => setActiveTab('projects')}
                className="text-garden-600 hover:text-garden-800 text-sm"
              >
                Alle {pendingProjects.length} anzeigen →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Recent Bookings */}
      {bookings.filter(b => b.status === 'pending').length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="font-bold text-xl text-gray-800 mb-4">
            📅 Neue Buchungsanfragen
          </h3>
          <div className="space-y-3">
            {bookings.filter(b => b.status === 'pending').slice(0, 3).map(booking => (
              <div key={booking.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-medium">{booking.guest_name}</div>
                  <div className="text-sm text-gray-600">
                    {new Date(booking.check_in).toLocaleDateString('de-DE')} - {new Date(booking.check_out).toLocaleDateString('de-DE')}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateBookingStatus(booking.id, 'confirmed')}
                    className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                  >
                    ✓ Bestätigen
                  </button>
                  <button
                    onClick={() => updateBookingStatus(booking.id, 'cancelled')}
                    className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                  >
                    ✗ Ablehnen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  // Pending Project Card
  const PendingProjectCard = ({ project, onConfirm }: { project: Project; onConfirm: (id: number, credit: number) => void }) => {
    const [creditAmount, setCreditAmount] = useState(0);
    const [showPhoto, setShowPhoto] = useState(false);

    return (
      <div className="border border-amber-200 rounded-lg p-4 bg-amber-50">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h4 className="font-medium text-gray-900">{project.title}</h4>
            <p className="text-sm text-gray-600 mt-1">
              Erledigt von: <strong>{project.completed_by}</strong>
              {project.completed_at && (
                <span className="ml-2">am {new Date(project.completed_at).toLocaleDateString('de-DE')}</span>
              )}
            </p>
            {project.completion_notes && (
              <p className="text-sm text-gray-500 mt-2 italic">"{project.completion_notes}"</p>
            )}
            {project.completion_photo && (
              <button
                onClick={() => setShowPhoto(!showPhoto)}
                className="text-sm text-garden-600 hover:text-garden-800 mt-2"
              >
                📸 Foto {showPhoto ? 'verbergen' : 'anzeigen'}
              </button>
            )}
            {showPhoto && project.completion_photo && (
              <img
                src={`${API_BASE}/images/gallery/${project.completion_photo}`}
                alt="Beweis-Foto"
                className="mt-2 max-w-xs rounded-lg shadow"
              />
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={creditAmount}
                onChange={(e) => setCreditAmount(Number(e.target.value))}
                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                placeholder="€"
                min="0"
              />
              <span className="text-sm text-gray-500">€ Guthaben</span>
            </div>
            <button
              onClick={() => onConfirm(project.id, creditAmount)}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
            >
              ✓ Bestätigen
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Bookings Tab
  const BookingsTab = () => (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Gast</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Zeitraum</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Preis</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Status</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Aktionen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {bookings.map(booking => (
            <tr key={booking.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-medium">{booking.guest_name}</div>
                <div className="text-sm text-gray-500">{booking.guest_email}</div>
              </td>
              <td className="px-4 py-3 text-sm">
                {new Date(booking.check_in).toLocaleDateString('de-DE')} - {new Date(booking.check_out).toLocaleDateString('de-DE')}
              </td>
              <td className="px-4 py-3 text-sm font-medium">{booking.total_price}€</td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  booking.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                  booking.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                  'bg-amber-100 text-amber-800'
                }`}>
                  {booking.status === 'confirmed' ? 'Bestätigt' :
                   booking.status === 'cancelled' ? 'Storniert' : 'Offen'}
                </span>
              </td>
              <td className="px-4 py-3">
                {booking.status === 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateBookingStatus(booking.id, 'confirmed')}
                      className="text-green-600 hover:text-green-800 text-sm"
                    >
                      ✓ Bestätigen
                    </button>
                    <button
                      onClick={() => updateBookingStatus(booking.id, 'cancelled')}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      ✗ Ablehnen
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bookings.length === 0 && (
        <div className="text-center py-8 text-gray-500">Keine Buchungen vorhanden</div>
      )}
    </div>
  );

  // Projects Tab
  const ProjectsTab = () => (
    <div className="space-y-4">
      {pendingProjects.length === 0 ? (
        <div className="bg-green-50 rounded-xl p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="font-bold text-green-800">Alles bestätigt!</h3>
          <p className="text-green-600">Es gibt keine unbestätigten Projekt-Erledigungen.</p>
        </div>
      ) : (
        pendingProjects.map(project => (
          <PendingProjectCard key={project.id} project={project} onConfirm={confirmProject} />
        ))
      )}
    </div>
  );

  // Users Tab
  const UsersTab = () => (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">User</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Rolle</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Letzter Login</th>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">Aktionen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {users.map(u => (
            <tr key={u.id} className="hover:bg-gray-50">
              <td className="px-4 py-3">
                <div className="font-medium">{u.name || u.username}</div>
                <div className="text-sm text-gray-500">{u.email}</div>
              </td>
              <td className="px-4 py-3">
                <span className={`text-xs px-2 py-1 rounded-full ${
                  u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {u.role === 'admin' ? 'Admin' : 'User'}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {u.last_login ? new Date(u.last_login).toLocaleString('de-DE') : 'Noch nie'}
              </td>
              <td className="px-4 py-3">
                {u.email !== 'moritzvoigt42@gmail.com' && (
                  <button
                    onClick={() => updateUserRole(u.id, u.role === 'admin' ? 'user' : 'admin')}
                    className="text-sm text-garden-600 hover:text-garden-800"
                  >
                    {u.role === 'admin' ? 'Zu User herabstufen' : 'Zu Admin befördern'}
                  </button>
                )}
                {u.email === 'moritzvoigt42@gmail.com' && (
                  <span className="text-xs text-gray-400">Haupt-Admin</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Admin-Dashboard</h1>
          <p className="text-gray-500">Eingeloggt als {user.name || user.email}</p>
        </div>
        <button
          onClick={logout}
          className="text-red-600 hover:text-red-800 text-sm"
        >
          Abmelden
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {[
          { key: 'dashboard', label: '📊 Dashboard' },
          { key: 'bookings', label: '📅 Buchungen' },
          { key: 'projects', label: '🔨 Projekte' },
          { key: 'users', label: '👥 User' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              activeTab === tab.key
                ? 'border-garden-600 text-garden-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'bookings' && <BookingsTab />}
      {activeTab === 'projects' && <ProjectsTab />}
      {activeTab === 'users' && <UsersTab />}
    </div>
  );
}
