import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import LoginModal from './LoginModal';

interface Project {
  id: number;
  title: string;
  description: string | null;
  category: string;
  status: 'offen' | 'next' | 'in_progress' | 'done';
  priority: 'kritisch' | 'hoch' | 'mittel' | 'niedrig';
  estimated_cost: string | null;
  effort: string | null;
  timeframe: string | null;
  assigned_to: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completion_photo: string | null;
  completion_notes: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  credit_awarded: number | null;
  created_at: string;
  created_by: string | null;
}

type ViewMode = 'kanban' | 'list';
type StatusColumn = 'offen' | 'next' | 'in_progress' | 'done';

const COLUMNS: { key: StatusColumn; label: string; color: string }[] = [
  { key: 'offen', label: 'Offen', color: 'bg-gray-100' },
  { key: 'next', label: 'Next', color: 'bg-blue-100' },
  { key: 'in_progress', label: 'In Arbeit', color: 'bg-amber-100' },
  { key: 'done', label: 'Erledigt', color: 'bg-green-100' },
];

const PRIORITIES: { value: string; label: string; color: string }[] = [
  { value: 'kritisch', label: 'Kritisch', color: 'bg-red-100 text-red-800 border-red-200' },
  { value: 'hoch', label: 'Hoch', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  { value: 'mittel', label: 'Mittel', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  { value: 'niedrig', label: 'Niedrig', color: 'bg-green-100 text-green-800 border-green-200' },
];

const CATEGORIES: { value: string; label: string; emoji: string }[] = [
  { value: 'wasser', label: 'Wasser', emoji: '💧' },
  { value: 'elektrik', label: 'Elektrik', emoji: '⚡' },
  { value: 'haus', label: 'Haus', emoji: '🏠' },
  { value: 'garten', label: 'Garten', emoji: '🌿' },
];

const API_BASE = import.meta.env.DEV ? 'http://localhost:5055' : '';

export default function ProjectKanban() {
  const { user, token, isAdmin } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [isLoading, setIsLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [draggedProject, setDraggedProject] = useState<Project | null>(null);

  // Fetch projects
  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/projects`);
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateProjectStatus = async (projectId: number, newStatus: StatusColumn) => {
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        setProjects(prev => prev.map(p =>
          p.id === projectId ? { ...p, status: newStatus } : p
        ));
      }
    } catch (error) {
      console.error('Failed to update project:', error);
    }
  };

  const handleDragStart = (project: Project) => {
    if (!user) return;
    setDraggedProject(project);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (status: StatusColumn) => {
    if (draggedProject && draggedProject.status !== status) {
      updateProjectStatus(draggedProject.id, status);
    }
    setDraggedProject(null);
  };

  const getPriorityStyle = (priority: string) => {
    const p = PRIORITIES.find(pr => pr.value === priority);
    return p?.color || 'bg-gray-100 text-gray-800';
  };

  const getCategoryEmoji = (category: string) => {
    const c = CATEGORIES.find(cat => cat.value === category);
    return c?.emoji || '📋';
  };

  const getProjectsByStatus = (status: StatusColumn) => {
    return projects.filter(p => p.status === status);
  };

  // Project Card Component
  const ProjectCard = ({ project }: { project: Project }) => {
    const isUnconfirmed = project.status === 'done' && !project.confirmed_at;

    return (
      <div
        draggable={!!user}
        onDragStart={() => handleDragStart(project)}
        className={`bg-white rounded-lg shadow-md p-4 mb-3 border-l-4 ${
          project.priority === 'kritisch' ? 'border-red-500' :
          project.priority === 'hoch' ? 'border-amber-500' :
          project.priority === 'mittel' ? 'border-blue-500' :
          'border-green-500'
        } ${user ? 'cursor-grab hover:shadow-lg' : ''} transition`}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-medium text-gray-900 text-sm">
            {getCategoryEmoji(project.category)} {project.title}
          </h4>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${getPriorityStyle(project.priority)}`}>
            {project.priority}
          </span>
        </div>

        {project.description && (
          <p className="text-xs text-gray-600 mb-2 line-clamp-2">{project.description}</p>
        )}

        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          {project.estimated_cost && (
            <span className="bg-gray-100 px-2 py-0.5 rounded">💰 {project.estimated_cost}</span>
          )}
          {project.effort && (
            <span className="bg-gray-100 px-2 py-0.5 rounded">⏱️ {project.effort}</span>
          )}
        </div>

        {isUnconfirmed && (
          <div className="mt-2 bg-amber-50 text-amber-700 text-xs px-2 py-1 rounded">
            ⏳ Warte auf Bestätigung
          </div>
        )}

        {project.confirmed_at && project.credit_awarded && (
          <div className="mt-2 bg-green-50 text-green-700 text-xs px-2 py-1 rounded">
            ✅ Bestätigt · {project.credit_awarded}€ Guthaben
          </div>
        )}

        {user && project.status !== 'done' && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setEditingProject(project)}
              className="text-xs text-garden-600 hover:text-garden-800"
            >
              Bearbeiten
            </button>
            {project.status === 'in_progress' && (
              <button
                onClick={() => setShowCompleteModal(project)}
                className="text-xs text-green-600 hover:text-green-800"
              >
                ✓ Als erledigt markieren
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // List View Component (for guests)
  const ListView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {CATEGORIES.map(category => {
        const categoryProjects = projects.filter(p => p.category === category.value && p.status !== 'done');
        if (categoryProjects.length === 0) return null;

        return (
          <div key={category.value} className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="font-display text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>{category.emoji}</span> {category.label}
            </h3>
            <ul className="space-y-3">
              {categoryProjects.map(project => (
                <li
                  key={project.id}
                  className={`border-l-4 pl-4 py-2 ${
                    project.priority === 'kritisch' ? 'border-red-500' :
                    project.priority === 'hoch' ? 'border-amber-500' :
                    project.priority === 'mittel' ? 'border-blue-500' :
                    'border-green-500'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-gray-900">{project.title}</h4>
                      {project.description && (
                        <p className="text-sm text-gray-600 mt-1">{project.description}</p>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ml-2 ${getPriorityStyle(project.priority)}`}>
                      {project.priority}
                    </span>
                  </div>
                  {project.estimated_cost && (
                    <div className="text-xs text-gray-500 mt-2">
                      Geschätzte Kosten: {project.estimated_cost}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );

  // Kanban View Component (for logged in users)
  const KanbanView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {COLUMNS.map(column => (
        <div
          key={column.key}
          className={`${column.color} rounded-xl p-4 min-h-[300px]`}
          onDragOver={handleDragOver}
          onDrop={() => handleDrop(column.key)}
        >
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center justify-between">
            <span>{column.label}</span>
            <span className="bg-white/50 px-2 py-0.5 rounded-full text-sm">
              {getProjectsByStatus(column.key).length}
            </span>
          </h3>

          <div className="space-y-3">
            {getProjectsByStatus(column.key).map(project => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>

          {column.key === 'offen' && user && (
            <button
              onClick={() => setShowAddModal(true)}
              className="w-full mt-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-garden-500 hover:text-garden-600 transition text-sm"
            >
              + Projekt hinzufügen
            </button>
          )}
        </div>
      ))}
    </div>
  );

  // Add Project Modal
  const AddProjectModal = () => {
    const [formData, setFormData] = useState({
      title: '',
      description: '',
      category: 'garten',
      priority: 'mittel',
      estimated_cost: '',
      effort: '',
      timeframe: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);

      try {
        const response = await fetch(`${API_BASE}/api/projects`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(formData)
        });

        if (response.ok) {
          await fetchProjects();
          setShowAddModal(false);
        }
      } catch (error) {
        console.error('Failed to create project:', error);
      } finally {
        setIsSubmitting(false);
      }
    };

    if (!showAddModal) return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
          <h2 className="text-xl font-bold text-garden-900 mb-4">Neues Projekt</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kategorie *</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.emoji} {cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priorität</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData(prev => ({ ...prev, priority: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
                >
                  {PRIORITIES.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Geschätzte Kosten</label>
                <input
                  type="text"
                  value={formData.estimated_cost}
                  onChange={(e) => setFormData(prev => ({ ...prev, estimated_cost: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
                  placeholder="z.B. 500-800€"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Aufwand</label>
                <input
                  type="text"
                  value={formData.effort}
                  onChange={(e) => setFormData(prev => ({ ...prev, effort: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
                  placeholder="z.B. 2-3 Tage"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zeitrahmen</label>
              <input
                type="text"
                value={formData.timeframe}
                onChange={(e) => setFormData(prev => ({ ...prev, timeframe: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
                placeholder="z.B. Frühjahr 2026"
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 disabled:bg-gray-400"
              >
                {isSubmitting ? 'Erstellt...' : 'Erstellen'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Complete Project Modal
  const CompleteProjectModal = () => {
    const [notes, setNotes] = useState('');
    const [photo, setPhoto] = useState<File | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!showCompleteModal) return null;

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);

      try {
        const formData = new FormData();
        formData.append('notes', notes);
        if (photo) {
          formData.append('photo', photo);
        }

        const response = await fetch(`${API_BASE}/api/projects/${showCompleteModal.id}/complete`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        if (response.ok) {
          await fetchProjects();
          setShowCompleteModal(null);
          setNotes('');
          setPhoto(null);
        }
      } catch (error) {
        console.error('Failed to complete project:', error);
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
          <h2 className="text-xl font-bold text-garden-900 mb-4">Projekt abschließen</h2>
          <p className="text-gray-600 mb-4">
            <strong>{showCompleteModal.title}</strong>
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notizen (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
                rows={3}
                placeholder="Was wurde gemacht? Besonderheiten?"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                📸 Beweis-Foto (empfohlen)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Ein Foto hilft bei der Admin-Bestätigung
              </p>
            </div>

            <div className="bg-amber-50 text-amber-700 px-4 py-3 rounded-lg text-sm">
              Nach dem Abschluss muss ein Admin die Erledigung bestätigen.
              Erst dann wird das Guthaben gutgeschrieben.
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowCompleteModal(null);
                  setNotes('');
                  setPhoto(null);
                }}
                className="flex-1 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400"
              >
                {isSubmitting ? 'Wird abgeschlossen...' : '✓ Als erledigt markieren'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-garden-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                Eingeloggt als <strong>{user.name || user.email}</strong>
                {isAdmin && <span className="ml-1 text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full">Admin</span>}
              </span>
            </div>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="text-sm text-garden-600 hover:text-garden-800 font-medium"
            >
              🔐 Anmelden zum Bearbeiten
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Ansicht:</span>
          <div className="flex rounded-lg overflow-hidden border border-gray-300">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 text-sm ${viewMode === 'list' ? 'bg-garden-600 text-white' : 'bg-white hover:bg-gray-50'}`}
            >
              Liste
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1 text-sm ${viewMode === 'kanban' ? 'bg-garden-600 text-white' : 'bg-white hover:bg-gray-50'}`}
            >
              Kanban
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {COLUMNS.map(column => (
          <div key={column.key} className={`${column.color} rounded-lg p-4 text-center`}>
            <div className="text-2xl font-bold text-gray-800">
              {getProjectsByStatus(column.key).length}
            </div>
            <div className="text-sm text-gray-600">{column.label}</div>
          </div>
        ))}
      </div>

      {/* Main Content */}
      {viewMode === 'kanban' ? <KanbanView /> : <ListView />}

      {/* Done Projects (collapsed by default) */}
      {viewMode === 'list' && getProjectsByStatus('done').length > 0 && (
        <details className="bg-green-50 rounded-xl p-4">
          <summary className="cursor-pointer font-semibold text-green-800">
            ✅ Erledigte Projekte ({getProjectsByStatus('done').length})
          </summary>
          <div className="mt-4 space-y-2">
            {getProjectsByStatus('done').map(project => (
              <div key={project.id} className="bg-white rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>{getCategoryEmoji(project.category)} {project.title}</span>
                  {project.confirmed_at ? (
                    <span className="text-green-600">✓ Bestätigt</span>
                  ) : (
                    <span className="text-amber-600">⏳ Warte auf Bestätigung</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Modals */}
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />
      <AddProjectModal />
      <CompleteProjectModal />
    </div>
  );
}
