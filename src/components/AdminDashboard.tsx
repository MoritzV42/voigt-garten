import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';
import EditableTable, { type ColumnDef } from './EditableTable';
import { MAP_AREAS, getAreaLabel } from './mapAreas';

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

interface Issue {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  photo_filename: string | null;
  reported_by: string;
  status: string;
  admin_notes: string | null;
  converted_to_project_id: number | null;
  created_at: string;
}

type Tab = 'dashboard' | 'bookings' | 'projects' | 'users' | 'issues' | 'galerie' | 'credits' | 'dienstleister' | 'kosten' | 'karte';

const API_BASE = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

export default function AdminDashboard() {
  const { user, token, isAdmin, logout } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<Stats | null>(null);
  const [pendingProjects, setPendingProjects] = useState<Project[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [galleryItems, setGalleryItems] = useState<any[]>([]);
  const [credits, setCredits] = useState<any[]>([]);
  const [serviceProviders, setServiceProviders] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [costsSummary, setCostsSummary] = useState<any>(null);

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
      fetchUsers(),
      fetchIssues(),
      fetchGalleryItems(),
      fetchCredits(),
      fetchServiceProviders(),
      fetchCosts(),
      fetchCostsSummary(),
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

  const fetchIssues = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/issues`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setIssues(data.issues || []);
      }
    } catch (error) {
      console.error('Failed to fetch issues:', error);
    }
  };

  const fetchGalleryItems = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/gallery?include_pending=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setGalleryItems(data.items || []);
      }
    } catch (error) {
      console.error('Failed to fetch gallery items:', error);
    }
  };

  const fetchCredits = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/credits`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCredits(data.credits || []);
      }
    } catch (error) {
      console.error('Failed to fetch credits:', error);
    }
  };

  const fetchServiceProviders = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/service-providers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setServiceProviders(data.providers || []);
      }
    } catch (error) {
      console.error('Failed to fetch service providers:', error);
    }
  };

  const fetchCosts = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/costs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCosts(data.costs || []);
      }
    } catch (error) {
      console.error('Failed to fetch costs:', error);
    }
  };

  const fetchCostsSummary = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/costs/summary`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setCostsSummary(data);
      }
    } catch (error) {
      console.error('Failed to fetch costs summary:', error);
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

  const approveIssue = async (issueId: number, data: { priority?: string; notes?: string }) => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/issues/${issueId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        await fetchIssues();
        await fetchAllData();
      } else {
        const result = await response.json();
        alert(result.error || 'Fehler beim Genehmigen');
      }
    } catch (error) {
      console.error('Failed to approve issue:', error);
    }
  };

  const rejectIssue = async (issueId: number, notes?: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/issues/${issueId}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ notes })
      });

      if (response.ok) {
        await fetchIssues();
      } else {
        const result = await response.json();
        alert(result.error || 'Fehler beim Ablehnen');
      }
    } catch (error) {
      console.error('Failed to reject issue:', error);
    }
  };

  const createUser = async (userData: { email: string; username: string; password: string; name?: string; role: string }) => {
    try {
      const response = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(userData)
      });

      if (response.ok) {
        await fetchUsers();
        setShowCreateUserModal(false);
      } else {
        const data = await response.json();
        alert(data.error || 'Fehler beim Erstellen');
      }
    } catch (error) {
      console.error('Failed to create user:', error);
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
            Anmelden
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

  const pendingIssuesCount = issues.filter(i => i.status === 'pending').length;

  // Dashboard Tab
  const DashboardTab = () => (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-amber-50 rounded-xl p-6">
          <div className="text-3xl font-bold text-amber-600">{stats?.pendingBookings || 0}</div>
          <div className="text-sm text-amber-700">Offene Buchungen</div>
        </div>
        <div className="bg-blue-50 rounded-xl p-6">
          <div className="text-3xl font-bold text-blue-600">{stats?.unconfirmedCompletions || 0}</div>
          <div className="text-sm text-blue-700">Unbestätigt</div>
        </div>
        <div className="bg-red-50 rounded-xl p-6">
          <div className="text-3xl font-bold text-red-600">{pendingIssuesCount}</div>
          <div className="text-sm text-red-700">Mängelmeldungen</div>
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

      {/* Pending Issues Alert */}
      {pendingIssuesCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h3 className="font-bold text-xl text-red-800 mb-4">
            ⚠️ Neue Mängelmeldungen ({pendingIssuesCount})
          </h3>
          <div className="space-y-3">
            {issues.filter(i => i.status === 'pending').slice(0, 3).map(issue => (
              <div key={issue.id} className="flex items-center justify-between p-3 bg-white rounded-lg">
                <div>
                  <div className="font-medium">{issue.title}</div>
                  <div className="text-sm text-gray-500">
                    Gemeldet von: {issue.reported_by} am {new Date(issue.created_at).toLocaleDateString('de-DE')}
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('issues')}
                  className="text-red-600 hover:text-red-800 text-sm font-medium"
                >
                  Ansehen →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending Confirmations */}
      {pendingProjects.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="font-bold text-xl text-gray-800 mb-4">
            Unbestätigte Erledigungen ({pendingProjects.length})
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
            Neue Buchungsanfragen
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
                <button
                  onClick={() => setActiveTab('bookings')}
                  className="text-garden-600 hover:text-garden-800 text-sm font-medium"
                >
                  Bearbeiten →
                </button>
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
                Foto {showPhoto ? 'verbergen' : 'anzeigen'}
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
              Bestätigen
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Bookings Tab
  const BookingsTab = () => (
    <EditableTable
      data={bookings}
      columns={[
        { field: 'id', label: 'ID', type: 'readonly', width: 'w-16' },
        { field: 'guest_name', label: 'Name', type: 'text' },
        { field: 'guest_email', label: 'Email', type: 'email' },
        { field: 'guest_phone', label: 'Telefon', type: 'text' },
        { field: 'check_in', label: 'Check-in', type: 'date' },
        { field: 'check_out', label: 'Check-out', type: 'date' },
        { field: 'guests', label: 'Gaeste', type: 'number', width: 'w-20' },
        { field: 'total_price', label: 'Preis (EUR)', type: 'number', width: 'w-24' },
        { field: 'status', label: 'Status', type: 'select', options: [
          { value: 'pending', label: 'Offen', color: 'bg-amber-100 text-amber-800' },
          { value: 'confirmed', label: 'Bestaetigt', color: 'bg-green-100 text-green-800' },
          { value: 'cancelled', label: 'Storniert', color: 'bg-red-100 text-red-800' },
        ]},
        { field: 'notes', label: 'Notizen', type: 'textarea' },
      ] as ColumnDef<any>[]}
      apiBase="/api/admin/bookings"
      token={token!}
      onDataChange={setBookings}
      emptyMessage="Keine Buchungen vorhanden"
    />
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

  // Issues Tab
  const IssuesTab = () => {
    const pendingIssues = issues.filter(i => i.status === 'pending');
    const processedIssues = issues.filter(i => i.status !== 'pending');

    const IssueCard = ({ issue }: { issue: Issue }) => {
      const [showPhoto, setShowPhoto] = useState(false);
      const [priority, setPriority] = useState('mittel');
      const [notes, setNotes] = useState('');

      return (
        <div className={`border rounded-lg p-4 ${
          issue.status === 'pending' ? 'border-red-200 bg-red-50' :
          issue.status === 'approved' ? 'border-green-200 bg-green-50' :
          'border-gray-200 bg-gray-50'
        }`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h4 className="font-medium text-gray-900">{issue.title}</h4>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  issue.status === 'pending' ? 'bg-amber-100 text-amber-800' :
                  issue.status === 'approved' ? 'bg-green-100 text-green-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {issue.status === 'pending' ? 'Offen' :
                   issue.status === 'approved' ? 'Genehmigt' : 'Abgelehnt'}
                </span>
              </div>
              {issue.description && (
                <p className="text-sm text-gray-600 mb-2">{issue.description}</p>
              )}
              <p className="text-sm text-gray-500">
                Gemeldet von: <strong>{issue.reported_by}</strong>
                <span className="ml-2">am {new Date(issue.created_at).toLocaleDateString('de-DE')}</span>
              </p>
              {issue.category && (
                <span className="inline-block mt-2 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">
                  {issue.category}
                </span>
              )}
              {issue.photo_filename && (
                <div className="mt-2">
                  <button
                    onClick={() => setShowPhoto(!showPhoto)}
                    className="text-sm text-garden-600 hover:text-garden-800"
                  >
                    Foto {showPhoto ? 'verbergen' : 'anzeigen'}
                  </button>
                  {showPhoto && (
                    <img
                      src={`${API_BASE}/images/gallery/${issue.photo_filename}`}
                      alt="Mangel-Foto"
                      className="mt-2 max-w-xs rounded-lg shadow"
                    />
                  )}
                </div>
              )}
              {issue.admin_notes && (
                <p className="text-sm text-gray-500 mt-2 italic">Admin-Notiz: {issue.admin_notes}</p>
              )}
            </div>
            {issue.status === 'pending' && (
              <div className="flex flex-col gap-2 min-w-[200px]">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm"
                >
                  <option value="niedrig">Priorität: Niedrig</option>
                  <option value="mittel">Priorität: Mittel</option>
                  <option value="hoch">Priorität: Hoch</option>
                  <option value="kritisch">Priorität: Kritisch</option>
                </select>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder="Notiz (optional)"
                />
                <button
                  onClick={() => approveIssue(issue.id, { priority, notes })}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  Als Projekt genehmigen
                </button>
                <button
                  onClick={() => rejectIssue(issue.id, notes)}
                  className="px-3 py-1 bg-red-100 text-red-700 text-sm rounded hover:bg-red-200"
                >
                  Ablehnen
                </button>
              </div>
            )}
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-6">
        {/* Pending Issues */}
        <div>
          <h3 className="font-bold text-lg text-gray-800 mb-4">
            Offene Mängelmeldungen ({pendingIssues.length})
          </h3>
          {pendingIssues.length === 0 ? (
            <div className="bg-green-50 rounded-xl p-8 text-center">
              <div className="text-4xl mb-4">✅</div>
              <h4 className="font-bold text-green-800">Keine offenen Meldungen</h4>
              <p className="text-green-600">Alle Mängelmeldungen wurden bearbeitet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingIssues.map(issue => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          )}
        </div>

        {/* Processed Issues */}
        {processedIssues.length > 0 && (
          <div>
            <h3 className="font-bold text-lg text-gray-800 mb-4">
              Bearbeitete Meldungen ({processedIssues.length})
            </h3>
            <div className="space-y-4">
              {processedIssues.slice(0, 10).map(issue => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Users Tab
  const UsersTab = () => {
    const CreateUserModal = () => {
      const [formData, setFormData] = useState({
        email: '',
        username: '',
        password: '',
        name: '',
        role: 'user'
      });

      return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold mb-4">Neuen User anlegen</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Passwort *</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rolle</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowCreateUserModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Abbrechen
              </button>
              <button
                onClick={() => createUser(formData)}
                className="flex-1 px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700"
              >
                Erstellen
              </button>
            </div>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            onClick={() => setShowCreateUserModal(true)}
            className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700"
          >
            + Neuer User
          </button>
        </div>
        <EditableTable
          data={users}
          columns={[
            { field: 'id', label: 'ID', type: 'readonly', width: 'w-16' },
            { field: 'email', label: 'Email', type: 'readonly' },
            { field: 'username', label: 'Username', type: 'text' },
            { field: 'name', label: 'Name', type: 'text' },
            { field: 'role', label: 'Rolle', type: 'select', options: [
              { value: 'admin', label: 'Admin', color: 'bg-purple-100 text-purple-800' },
              { value: 'user', label: 'User', color: 'bg-gray-100 text-gray-800' },
              { value: 'guest', label: 'Gast', color: 'bg-blue-100 text-blue-800' },
            ]},
            { field: 'last_login', label: 'Letzter Login', type: 'readonly',
              render: (v: string) => v ? new Date(v).toLocaleString('de-DE') : 'Noch nie' },
            { field: 'created_at', label: 'Erstellt', type: 'readonly',
              render: (v: string) => v ? new Date(v).toLocaleDateString('de-DE') : '-' },
          ] as ColumnDef<any>[]}
          apiBase="/api/admin/users"
          token={token!}
          onDataChange={setUsers}
          canDelete={true}
        />
        {showCreateUserModal && <CreateUserModal />}
      </div>
    );
  };

  // Galerie Tab
  const GalerieTab = () => (
    <EditableTable
      data={galleryItems}
      columns={[
        { field: 'id', label: 'ID', type: 'readonly', width: 'w-20' },
        { field: 'name', label: 'Name', type: 'text' },
        { field: 'description', label: 'Beschreibung', type: 'textarea' },
        { field: 'category', label: 'Kategorie', type: 'select', options: [
          { value: 'garten', label: 'Garten' },
          { value: 'haus', label: 'Haus' },
          { value: 'umgebung', label: 'Umgebung' },
          { value: 'sonstiges', label: 'Sonstiges' },
        ]},
        { field: 'status', label: 'Status', type: 'select', options: [
          { value: 'approved', label: 'Freigegeben', color: 'bg-green-100 text-green-800' },
          { value: 'pending', label: 'Ausstehend', color: 'bg-amber-100 text-amber-800' },
          { value: 'rejected', label: 'Abgelehnt', color: 'bg-red-100 text-red-800' },
        ]},
        { field: 'uploaded_at', label: 'Hochgeladen', type: 'readonly',
          render: (v: string) => v ? new Date(v).toLocaleDateString('de-DE') : '-' },
      ] as ColumnDef<any>[]}
      apiBase="/api/admin/gallery"
      token={token!}
      onDataChange={setGalleryItems}
      canDelete={true}
      emptyMessage="Keine Galerie-Eintraege"
    />
  );

  // Credits Tab
  const CreditsTab = () => (
    <EditableTable
      data={credits}
      columns={[
        { field: 'id', label: 'ID', type: 'readonly', width: 'w-16' },
        { field: 'guest_email', label: 'Email', type: 'email' },
        { field: 'amount', label: 'Betrag (EUR)', type: 'number', width: 'w-24' },
        { field: 'reason', label: 'Grund', type: 'text' },
        { field: 'type', label: 'Typ', type: 'select', options: [
          { value: 'earned', label: 'Verdient', color: 'bg-green-100 text-green-800' },
          { value: 'spent', label: 'Ausgegeben', color: 'bg-red-100 text-red-800' },
        ]},
        { field: 'created_at', label: 'Datum', type: 'readonly',
          render: (v: string) => v ? new Date(v).toLocaleDateString('de-DE') : '-' },
      ] as ColumnDef<any>[]}
      apiBase="/api/admin/credits"
      token={token!}
      onDataChange={setCredits}
      canAdd={true}
      canDelete={true}
      newRowDefaults={{ guest_email: '', amount: 0, reason: '', type: 'earned' }}
      emptyMessage="Keine Credits vorhanden"
    />
  );

  // Dienstleister Tab
  const DienstleisterTab = () => (
    <EditableTable
      data={serviceProviders}
      columns={[
        { field: 'id', label: 'ID', type: 'readonly', width: 'w-16' },
        { field: 'name', label: 'Name', type: 'text' },
        { field: 'category', label: 'Kategorie', type: 'select', options: [
          { value: 'Elektriker', label: 'Elektriker' },
          { value: 'Klempner', label: 'Klempner' },
          { value: 'Gaertner', label: 'Gaertner' },
          { value: 'Maler', label: 'Maler' },
          { value: 'Dachdecker', label: 'Dachdecker' },
          { value: 'Allrounder', label: 'Allrounder' },
          { value: 'Sonstiges', label: 'Sonstiges' },
        ]},
        { field: 'email', label: 'Email', type: 'email' },
        { field: 'phone', label: 'Telefon', type: 'text' },
        { field: 'rating', label: 'Bewertung', type: 'number', width: 'w-24' },
        { field: 'notes', label: 'Notizen', type: 'textarea' },
        { field: 'verified', label: 'Verifiziert', type: 'boolean' },
      ] as ColumnDef<any>[]}
      apiBase="/api/service-providers"
      token={token!}
      onDataChange={setServiceProviders}
      canAdd={true}
      canDelete={true}
      newRowDefaults={{ name: '', category: 'Sonstiges' }}
      emptyMessage="Keine Dienstleister vorhanden"
    />
  );

  // Kosten Tab
  const KostenTab = () => (
    <div className="space-y-6">
      {costsSummary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-blue-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-blue-600">{costsSummary.monthly?.toFixed(0) || 0}EUR</div>
            <div className="text-sm text-blue-700">Monatlich</div>
          </div>
          <div className="bg-purple-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-purple-600">{costsSummary.yearly?.toFixed(0) || 0}EUR</div>
            <div className="text-sm text-purple-700">Jaehrlich</div>
          </div>
          <div className="bg-amber-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-amber-600">{costsSummary.once?.toFixed(0) || 0}EUR</div>
            <div className="text-sm text-amber-700">Einmalig</div>
          </div>
          <div className="bg-green-50 rounded-xl p-4">
            <div className="text-2xl font-bold text-green-600">{costsSummary.total_yearly?.toFixed(0) || 0}EUR</div>
            <div className="text-sm text-green-700">Gesamt/Jahr</div>
          </div>
        </div>
      )}
      <EditableTable
        data={costs}
        columns={[
          { field: 'id', label: 'ID', type: 'readonly', width: 'w-16' },
          { field: 'title', label: 'Titel', type: 'text' },
          { field: 'description', label: 'Beschreibung', type: 'textarea' },
          { field: 'amount', label: 'Betrag (EUR)', type: 'number', width: 'w-24' },
          { field: 'frequency', label: 'Frequenz', type: 'select', options: [
            { value: 'einmalig', label: 'Einmalig' },
            { value: 'monatlich', label: 'Monatlich', color: 'bg-blue-100 text-blue-800' },
            { value: 'jaehrlich', label: 'Jaehrlich', color: 'bg-purple-100 text-purple-800' },
          ]},
          { field: 'category', label: 'Kategorie', type: 'text' },
          { field: 'date', label: 'Datum', type: 'date' },
          { field: 'is_active', label: 'Aktiv', type: 'boolean' },
        ] as ColumnDef<any>[]}
        apiBase="/api/costs"
        token={token!}
        onDataChange={(newData) => { setCosts(newData); fetchCostsSummary(); }}
        canAdd={true}
        canDelete={true}
        newRowDefaults={{ title: '', amount: 0, frequency: 'einmalig', is_active: true }}
        emptyMessage="Keine Kosten vorhanden"
      />
    </div>
  );

  // Karte Tab
  const KarteTab = () => {
    const [descriptions, setDescriptions] = useState<Record<string, { description: string; updated_at?: string; updated_by?: string }>>({});
    const [galleryItems, setGalleryItems] = useState<any[]>([]);
    const [areaFilter, setAreaFilter] = useState('all');
    const [saving, setSaving] = useState<string | null>(null);

    useEffect(() => {
      // Fetch descriptions
      fetch(`${API_BASE}/api/map/area-descriptions`)
        .then(r => r.json())
        .then(data => setDescriptions(data))
        .catch(() => {});

      // Fetch gallery items
      fetch(`${API_BASE}/api/gallery?include_pending=true`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(data => setGalleryItems(data.items || []))
        .catch(() => {});
    }, []);

    const saveDescription = async (areaId: string, description: string) => {
      setSaving(areaId);
      try {
        await fetch(`${API_BASE}/api/admin/map/area-descriptions`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ area_id: areaId, description })
        });
        setDescriptions(prev => ({ ...prev, [areaId]: { ...prev[areaId], description } }));
      } catch (err) {
        console.error('Failed to save description:', err);
      }
      setSaving(null);
    };

    const assignMapArea = async (itemId: string, mapArea: string) => {
      try {
        await fetch(`${API_BASE}/api/admin/gallery/${itemId}/map-area`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ map_area: mapArea || null })
        });
        setGalleryItems(prev => prev.map(i => i.id === itemId ? { ...i, map_area: mapArea || null } : i));
      } catch (err) {
        console.error('Failed to assign map area:', err);
      }
    };

    const filteredGallery = areaFilter === 'all'
      ? galleryItems
      : areaFilter === 'none'
        ? galleryItems.filter(i => !i.map_area)
        : galleryItems.filter(i => i.map_area === areaFilter);

    return (
      <div className="space-y-8">
        {/* Section A: Area Descriptions */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="font-bold text-xl text-gray-800 mb-6">Bereichsbeschreibungen</h3>
          <div className="space-y-4">
            {MAP_AREAS.map(area => {
              const desc = descriptions[area.id]?.description || '';
              return (
                <DescriptionEditor
                  key={area.id}
                  areaId={area.id}
                  label={area.label}
                  initialDescription={desc}
                  isSaving={saving === area.id}
                  onSave={saveDescription}
                />
              );
            })}
          </div>
        </div>

        {/* Section B: Photo Assignment */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <h3 className="font-bold text-xl text-gray-800 mb-4">Fotos zuordnen</h3>

          {/* Filter */}
          <div className="flex flex-wrap gap-2 mb-6">
            <button
              onClick={() => setAreaFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${areaFilter === 'all' ? 'bg-garden-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              Alle ({galleryItems.length})
            </button>
            <button
              onClick={() => setAreaFilter('none')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${areaFilter === 'none' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              Nicht zugeordnet ({galleryItems.filter(i => !i.map_area).length})
            </button>
            {MAP_AREAS.map(area => {
              const count = galleryItems.filter(i => i.map_area === area.id).length;
              if (count === 0) return null;
              return (
                <button
                  key={area.id}
                  onClick={() => setAreaFilter(area.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${areaFilter === area.id ? 'bg-garden-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {area.label} ({count})
                </button>
              );
            })}
          </div>

          {/* Photo Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredGallery.map(item => (
              <div key={item.id} className="space-y-2">
                <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                  {item.type === 'video' ? (
                    <video src={item.url} className="w-full h-full object-cover" />
                  ) : (
                    <img
                      src={item.thumbnailUrl || item.url}
                      alt={item.name || 'Bild'}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <select
                  value={item.map_area || ''}
                  onChange={e => assignMapArea(item.id, e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                >
                  <option value="">Kein Bereich</option>
                  {MAP_AREAS.map(area => (
                    <option key={area.id} value={area.id}>{area.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {filteredGallery.length === 0 && (
            <div className="text-center py-8 text-gray-500">Keine Fotos in dieser Kategorie</div>
          )}
        </div>
      </div>
    );
  };

  // Helper component for description editing
  const DescriptionEditor = ({ areaId, label, initialDescription, isSaving, onSave }: {
    areaId: string;
    label: string;
    initialDescription: string;
    isSaving: boolean;
    onSave: (id: string, desc: string) => void;
  }) => {
    const [text, setText] = useState(initialDescription);
    const changed = text !== initialDescription;

    useEffect(() => {
      setText(initialDescription);
    }, [initialDescription]);

    return (
      <div className="flex flex-col sm:flex-row gap-3 items-start p-4 bg-gray-50 rounded-lg">
        <div className="sm:w-40 font-medium text-gray-700 pt-2">{label}</div>
        <div className="flex-1 w-full">
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:ring-2 focus:ring-garden-500 focus:border-transparent"
            placeholder="Beschreibung eingeben..."
          />
        </div>
        <button
          onClick={() => onSave(areaId, text)}
          disabled={!changed || isSaving}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
            changed
              ? 'bg-garden-600 text-white hover:bg-garden-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {isSaving ? 'Speichert...' : 'Speichern'}
        </button>
      </div>
    );
  };

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
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {[
          { key: 'dashboard', label: 'Dashboard' },
          { key: 'issues', label: `Mängel${pendingIssuesCount > 0 ? ` (${pendingIssuesCount})` : ''}`, badge: pendingIssuesCount > 0 },
          { key: 'bookings', label: 'Buchungen' },
          { key: 'projects', label: 'Projekte' },
          { key: 'galerie', label: 'Galerie' },
          { key: 'credits', label: 'Credits' },
          { key: 'dienstleister', label: 'Dienstleister' },
          { key: 'kosten', label: 'Kosten' },
          { key: 'karte', label: 'Karte' },
          { key: 'users', label: 'User' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition whitespace-nowrap ${
              activeTab === tab.key
                ? 'border-garden-600 text-garden-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            } ${tab.badge ? 'relative' : ''}`}
          >
            {tab.label}
            {tab.badge && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'dashboard' && <DashboardTab />}
      {activeTab === 'issues' && <IssuesTab />}
      {activeTab === 'bookings' && <BookingsTab />}
      {activeTab === 'projects' && <ProjectsTab />}
      {activeTab === 'galerie' && <GalerieTab />}
      {activeTab === 'credits' && <CreditsTab />}
      {activeTab === 'dienstleister' && <DienstleisterTab />}
      {activeTab === 'kosten' && <KostenTab />}
      {activeTab === 'karte' && <KarteTab />}
      {activeTab === 'users' && <UsersTab />}
    </div>
  );
}
