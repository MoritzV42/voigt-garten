import { useState, useEffect } from 'react';

interface RecurringTask {
  id: number;
  title: string;
  description?: string;
  category: string;
  cycle_days: number;
  credit_value: number;
  effort: string;
  next_due?: string;
  is_active: boolean;
  last_completed_at?: string;
  last_completed_by?: string;
  status?: string;
}

const CATEGORIES = [
  { id: 'rasen', label: '🌿 Rasenpflege' },
  { id: 'beete', label: '🌻 Beetarbeiten' },
  { id: 'baeume', label: '🌳 Bäume & Hecken' },
  { id: 'brennholz', label: '🪵 Brennholz' },
  { id: 'elektrik', label: '⚡ Elektrik' },
  { id: 'putzen', label: '🧹 Reinigung' },
  { id: 'sonstiges', label: '🔧 Sonstiges' },
];

const EFFORTS = [
  { id: 'leicht', label: 'Leicht' },
  { id: 'mittel', label: 'Mittel' },
  { id: 'schwer', label: 'Schwer' },
];

export default function RecurringTaskEditor() {
  const [tasks, setTasks] = useState<RecurringTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTask, setEditingTask] = useState<RecurringTask | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');

  const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

  useEffect(() => {
    fetchTasks();
  }, [filterCategory]);

  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterCategory) params.append('category', filterCategory);
      params.append('active', 'false'); // Get all tasks including inactive

      const response = await fetch(`${API_URL}/api/recurring-tasks?${params}`);
      const data = await response.json();

      if (response.ok) {
        setTasks(data.tasks || []);
      } else {
        setError(data.error || 'Fehler beim Laden');
      }
    } catch (err) {
      setError('Verbindungsfehler');
    }
    setIsLoading(false);
  };

  const handleSave = async (task: Partial<RecurringTask>) => {
    const token = localStorage.getItem('voigt-garten-token');

    try {
      const isNew = !task.id;
      const url = isNew
        ? `${API_URL}/api/recurring-tasks`
        : `${API_URL}/api/recurring-tasks/${task.id}`;

      const response = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(task)
      });

      if (response.ok) {
        fetchTasks();
        setEditingTask(null);
        setShowCreateModal(false);
      } else {
        const data = await response.json();
        alert(data.error || 'Fehler beim Speichern');
      }
    } catch (err) {
      alert('Verbindungsfehler');
    }
  };

  const handleDelete = async (taskId: number) => {
    if (!confirm('Aufgabe wirklich löschen?')) return;

    const token = localStorage.getItem('voigt-garten-token');

    try {
      const response = await fetch(`${API_URL}/api/recurring-tasks/${taskId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        fetchTasks();
      } else {
        const data = await response.json();
        alert(data.error || 'Fehler beim Löschen');
      }
    } catch (err) {
      alert('Verbindungsfehler');
    }
  };

  const handleToggleActive = async (task: RecurringTask) => {
    await handleSave({ id: task.id, is_active: !task.is_active });
  };

  const TaskForm = ({ task, onSave, onCancel }: {
    task: Partial<RecurringTask>;
    onSave: (t: Partial<RecurringTask>) => void;
    onCancel: () => void;
  }) => {
    const [formData, setFormData] = useState({
      title: task.title || '',
      description: task.description || '',
      category: task.category || 'sonstiges',
      cycle_days: task.cycle_days || 30,
      credit_value: task.credit_value || 0,
      effort: task.effort || 'mittel',
      is_active: task.is_active !== false,
    });

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
          <h3 className="text-lg font-bold mb-4">
            {task.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
          </h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kategorie</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Aufwand</label>
                <select
                  value={formData.effort}
                  onChange={(e) => setFormData({ ...formData, effort: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  {EFFORTS.map(eff => (
                    <option key={eff.id} value={eff.id}>{eff.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Intervall (Tage)</label>
                <input
                  type="number"
                  value={formData.cycle_days}
                  onChange={(e) => setFormData({ ...formData, cycle_days: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  min={1}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Guthaben (€)</label>
                <input
                  type="number"
                  value={formData.credit_value}
                  onChange={(e) => setFormData({ ...formData, credit_value: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  min={0}
                  step={0.5}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="rounded border-gray-300"
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">Aktiv</label>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={() => onSave({ ...task, ...formData })}
              className="flex-1 px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700"
            >
              Speichern
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Group tasks by category
  const tasksByCategory = tasks.reduce((acc, task) => {
    const cat = task.category || 'sonstiges';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(task);
    return acc;
  }, {} as Record<string, RecurringTask[]>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Wiederkehrende Aufgaben</h2>
          <p className="text-sm text-gray-500">{tasks.length} Aufgaben insgesamt</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700"
        >
          + Neue Aufgabe
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-4">
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg"
        >
          <option value="">Alle Kategorien</option>
          {CATEGORIES.map(cat => (
            <option key={cat.id} value={cat.id}>{cat.label}</option>
          ))}
        </select>
      </div>

      {/* Tasks List */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-garden-600 mx-auto" />
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(tasksByCategory).map(([category, categoryTasks]) => {
            const catInfo = CATEGORIES.find(c => c.id === category);
            return (
              <div key={category} className="bg-white rounded-xl shadow overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <h3 className="font-medium text-gray-900">{catInfo?.label || category}</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {categoryTasks.map(task => (
                    <div
                      key={task.id}
                      className={`px-4 py-3 flex items-center justify-between ${!task.is_active ? 'opacity-50' : ''}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{task.title}</span>
                          {!task.is_active && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">Inaktiv</span>
                          )}
                          {task.status === 'overdue' && (
                            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Überfällig</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 flex gap-4 mt-1">
                          <span>🔄 alle {task.cycle_days} Tage</span>
                          <span>💰 {task.credit_value}€</span>
                          <span>📊 {task.effort}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleToggleActive(task)}
                          className={`px-3 py-1 rounded text-sm ${
                            task.is_active
                              ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {task.is_active ? 'Deaktivieren' : 'Aktivieren'}
                        </button>
                        <button
                          onClick={() => setEditingTask(task)}
                          className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-sm hover:bg-blue-200"
                        >
                          Bearbeiten
                        </button>
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200"
                        >
                          Löschen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      {showCreateModal && (
        <TaskForm
          task={{}}
          onSave={handleSave}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

      {editingTask && (
        <TaskForm
          task={editingTask}
          onSave={handleSave}
          onCancel={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
