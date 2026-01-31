import { useState, useEffect, useRef } from 'react';
import TaskDetailModal from './TaskDetailModal';
import IssueReportModal from './IssueReportModal';

interface User {
  id: number;
  email: string;
  username?: string;
  name?: string;
  role: 'user' | 'admin';
}

interface Task {
  id: number;
  title: string;
  description?: string;
  category: string;
  task_type: 'recurring' | 'project';
  status?: string;
  priority?: string;
  effort?: string;
  credit_value?: number;
  cycle_days?: number;
  next_due?: string;
  due_status?: 'overdue' | 'due-soon' | 'ok';
  assigned_to?: string;
  estimated_cost?: string;
  completed_at?: string;
  completed_by?: string;
  completion_photo?: string;
  confirmed_at?: string;
  last_completed_at?: string;
  last_completed_by?: string;
}

interface Filters {
  categories: string[];
  efforts: string[];
  assignees: string[];
}

const TOKEN_KEY = 'voigt-garten-token';
const USER_KEY = 'voigt-garten-user';

const CATEGORY_CONFIG: Record<string, { emoji: string; label: string; color: string }> = {
  rasen: { emoji: '🌿', label: 'Rasenpflege', color: 'bg-green-100 text-green-800' },
  beete: { emoji: '🌻', label: 'Beetarbeiten', color: 'bg-yellow-100 text-yellow-800' },
  baeume: { emoji: '🌳', label: 'Bäume & Hecken', color: 'bg-emerald-100 text-emerald-800' },
  brennholz: { emoji: '🪵', label: 'Brennholz', color: 'bg-amber-100 text-amber-800' },
  elektrik: { emoji: '⚡', label: 'Elektrik', color: 'bg-blue-100 text-blue-800' },
  putzen: { emoji: '🧹', label: 'Reinigung', color: 'bg-purple-100 text-purple-800' },
  sonstiges: { emoji: '🔧', label: 'Sonstiges', color: 'bg-gray-100 text-gray-800' },
  wasser: { emoji: '💧', label: 'Wasser', color: 'bg-cyan-100 text-cyan-800' },
  haus: { emoji: '🏠', label: 'Haus', color: 'bg-orange-100 text-orange-800' },
  garten: { emoji: '🌱', label: 'Garten', color: 'bg-lime-100 text-lime-800' },
};

const PRIORITY_COLORS: Record<string, string> = {
  kritisch: 'border-l-red-500 bg-red-50',
  hoch: 'border-l-amber-500 bg-amber-50',
  mittel: 'border-l-blue-500 bg-blue-50',
  niedrig: 'border-l-green-500 bg-green-50',
};

const STATUS_COLUMNS = [
  { id: 'offen', label: 'Offen', color: 'bg-gray-100' },
  { id: 'next', label: 'Als Nächstes', color: 'bg-blue-100' },
  { id: 'in_progress', label: 'In Arbeit', color: 'bg-yellow-100' },
  { id: 'done', label: 'Erledigt', color: 'bg-green-100' },
];

type SortField = 'title' | 'category' | 'task_type' | 'status' | 'credit_value';
type SortOrder = 'asc' | 'desc';

export default function UnifiedKanban() {
  const [user, setUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filters, setFilters] = useState<Filters>({ categories: [], efforts: [], assignees: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);

  // Multi-select filters
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterEfforts, setFilterEfforts] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);

  // Sorting
  const [sortField, setSortField] = useState<SortField>('title');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Drag and drop
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Filter dropdowns
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const [showEffortFilter, setShowEffortFilter] = useState(false);
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [showStatusFilter, setShowStatusFilter] = useState(false);

  const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

  // Load user from localStorage and listen for changes
  useEffect(() => {
    const loadUser = () => {
      const storedUser = localStorage.getItem(USER_KEY);
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    };

    loadUser();

    // Listen for auth changes
    const handleAuthChange = (e: CustomEvent) => {
      if (e.detail?.user) {
        setUser(e.detail.user);
      } else {
        setUser(null);
      }
    };

    window.addEventListener('auth-change', handleAuthChange as EventListener);
    window.addEventListener('storage', loadUser);

    return () => {
      window.removeEventListener('auth-change', handleAuthChange as EventListener);
      window.removeEventListener('storage', loadUser);
    };
  }, []);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/tasks/unified`);
      const data = await response.json();

      if (response.ok) {
        setTasks(data.tasks || []);
        setFilters(data.filters || { categories: [], efforts: [], assignees: [] });
      } else {
        setError(data.error || 'Fehler beim Laden');
      }
    } catch (err) {
      setError('Verbindungsfehler');
    }
    setIsLoading(false);
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
  };

  const handleCompleteTask = async (taskId: number, taskType: string, notes?: string, photo?: File) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    const endpoint = taskType === 'recurring'
      ? `${API_URL}/api/recurring-tasks/${taskId}/complete`
      : `${API_URL}/api/projects/${taskId}/complete`;

    try {
      let response;
      if (photo) {
        const formData = new FormData();
        formData.append('photo', photo);
        if (notes) formData.append('notes', notes);

        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
      } else {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ notes })
        });
      }

      if (response.ok) {
        fetchTasks();
        setSelectedTask(null);
      }
    } catch (err) {
      console.error('Error completing task:', err);
    }
  };

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    try {
      const response = await fetch(`${API_URL}/api/projects/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (response.ok) {
        fetchTasks();
      }
    } catch (err) {
      console.error('Error updating status:', err);
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, task: Task) => {
    if (task.task_type !== 'project') {
      e.preventDefault();
      return;
    }
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.id.toString());
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedTask || draggedTask.task_type !== 'project') {
      setDraggedTask(null);
      return;
    }

    if (draggedTask.status !== newStatus) {
      await handleStatusChange(draggedTask.id, newStatus);
    }
    setDraggedTask(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDragOverColumn(null);
  };

  // Filter tasks
  const getFilteredTasks = () => {
    return tasks.filter(task => {
      if (filterCategories.length > 0 && !filterCategories.includes(task.category)) return false;
      if (filterEfforts.length > 0 && task.effort && !filterEfforts.includes(task.effort)) return false;
      if (filterTypes.length > 0 && !filterTypes.includes(task.task_type)) return false;
      if (filterStatuses.length > 0) {
        const status = task.task_type === 'recurring' ? task.due_status : task.status;
        if (status && !filterStatuses.includes(status)) return false;
      }
      return true;
    });
  };

  // Sort tasks
  const getSortedTasks = (tasksToSort: Task[]) => {
    return [...tasksToSort].sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      if (sortField === 'status') {
        aVal = a.task_type === 'recurring' ? a.due_status : a.status;
        bVal = b.task_type === 'recurring' ? b.due_status : b.status;
      }

      if (aVal === undefined || aVal === null) aVal = '';
      if (bVal === undefined || bVal === null) bVal = '';

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const getTasksByStatus = (status: string) => {
    const filtered = getFilteredTasks();
    return filtered.filter(t => {
      if (t.task_type === 'recurring') {
        if (status === 'offen' && (t.due_status === 'overdue' || t.due_status === 'due-soon')) return true;
        return false;
      }
      return (t.status || 'offen') === status;
    });
  };

  // Multi-select filter component
  const MultiSelectFilter = ({
    label,
    options,
    selected,
    onChange,
    isOpen,
    onToggle,
    renderOption
  }: {
    label: string;
    options: string[];
    selected: string[];
    onChange: (values: string[]) => void;
    isOpen: boolean;
    onToggle: () => void;
    renderOption?: (opt: string) => string;
  }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) {
          if (isOpen) onToggle();
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onToggle]);

    const toggleOption = (opt: string) => {
      if (selected.includes(opt)) {
        onChange(selected.filter(s => s !== opt));
      } else {
        onChange([...selected, opt]);
      }
    };

    return (
      <div ref={ref} className="relative">
        <button
          onClick={onToggle}
          className={`px-3 py-2 border rounded-lg text-sm flex items-center gap-2 transition ${
            selected.length > 0
              ? 'border-garden-500 bg-garden-50 text-garden-700'
              : 'border-gray-300 text-gray-700 hover:border-gray-400'
          }`}
        >
          {label}
          {selected.length > 0 && (
            <span className="bg-garden-600 text-white text-xs px-1.5 py-0.5 rounded-full">
              {selected.length}
            </span>
          )}
          <svg className={`w-4 h-4 transition ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[200px] py-2">
            {options.map(opt => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggleOption(opt)}
                  className="rounded border-gray-300 text-garden-600 focus:ring-garden-500"
                />
                <span className="text-sm">{renderOption ? renderOption(opt) : opt}</span>
              </label>
            ))}
            {selected.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100 mt-1"
              >
                Alle abwählen
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderTaskCard = (task: Task, draggable: boolean = false) => {
    const category = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.sonstiges;
    const priorityClass = task.priority ? PRIORITY_COLORS[task.priority] : 'border-l-gray-300';
    const isDragging = draggedTask?.id === task.id && draggedTask?.task_type === task.task_type;

    return (
      <div
        key={`${task.task_type}-${task.id}`}
        draggable={draggable && task.task_type === 'project'}
        onDragStart={(e) => handleDragStart(e, task)}
        onDragEnd={handleDragEnd}
        onClick={() => handleTaskClick(task)}
        className={`p-4 rounded-lg border-l-4 ${priorityClass} shadow-sm hover:shadow-md transition cursor-pointer mb-3 ${
          isDragging ? 'opacity-50' : ''
        } ${draggable && task.task_type === 'project' ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-medium text-gray-900 text-sm">{task.title}</h4>
          {task.task_type === 'recurring' && (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full whitespace-nowrap">
              🔄 {task.cycle_days}d
            </span>
          )}
        </div>

        {/* Category Badge */}
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${category.color}`}>
          {category.emoji} {category.label}
        </span>

        {/* Due Status for Recurring */}
        {task.task_type === 'recurring' && task.due_status && (
          <div className={`mt-2 text-xs font-medium ${
            task.due_status === 'overdue' ? 'text-red-600' :
            task.due_status === 'due-soon' ? 'text-amber-600' : 'text-green-600'
          }`}>
            {task.due_status === 'overdue' ? `⚠️ Überfällig` :
             task.due_status === 'due-soon' ? `⏰ Bald fällig` : '✓ OK'}
          </div>
        )}

        {/* Credits */}
        {task.credit_value && task.credit_value > 0 && (
          <div className="mt-2 text-xs text-garden-600 font-medium">
            💰 {task.credit_value}€ Guthaben
          </div>
        )}

        {/* Effort */}
        {task.effort && (
          <div className="mt-1 text-xs text-gray-500">
            Aufwand: {task.effort}
          </div>
        )}
      </div>
    );
  };

  const renderKanbanView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {STATUS_COLUMNS.map(column => {
        const columnTasks = getTasksByStatus(column.id);
        const isOver = dragOverColumn === column.id;
        return (
          <div
            key={column.id}
            onDragOver={(e) => handleDragOver(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, column.id)}
            className={`${column.color} rounded-xl p-4 min-h-[300px] transition-all ${
              isOver ? 'ring-2 ring-garden-500 ring-opacity-50' : ''
            }`}
          >
            <h3 className="font-bold text-gray-800 mb-4 flex items-center justify-between">
              {column.label}
              <span className="text-sm font-normal bg-white/50 px-2 py-0.5 rounded-full">
                {columnTasks.length}
              </span>
            </h3>
            <div className="space-y-3">
              {columnTasks.map(task => renderTaskCard(task, true))}
              {columnTasks.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-8">
                  {isOver ? 'Hier ablegen' : 'Keine Aufgaben'}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <span className="text-gray-300 ml-1">↕</span>;
    }
    return <span className="text-garden-600 ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  const renderListView = () => {
    const sortedTasks = getSortedTasks(getFilteredTasks());

    return (
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th
                onClick={() => handleSort('title')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
              >
                Aufgabe <SortIcon field="title" />
              </th>
              <th
                onClick={() => handleSort('category')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
              >
                Kategorie <SortIcon field="category" />
              </th>
              <th
                onClick={() => handleSort('task_type')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
              >
                Typ <SortIcon field="task_type" />
              </th>
              <th
                onClick={() => handleSort('status')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
              >
                Status <SortIcon field="status" />
              </th>
              <th
                onClick={() => handleSort('credit_value')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
              >
                Guthaben <SortIcon field="credit_value" />
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedTasks.map(task => {
              const category = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.sonstiges;
              return (
                <tr
                  key={`${task.task_type}-${task.id}`}
                  onClick={() => handleTaskClick(task)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{task.title}</div>
                    {task.description && (
                      <div className="text-sm text-gray-500 truncate max-w-xs">{task.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${category.color}`}>
                      {category.emoji} {category.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {task.task_type === 'recurring' ? (
                      <span className="text-purple-600">🔄 Wiederkehrend</span>
                    ) : (
                      <span className="text-blue-600">📋 Projekt</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {task.task_type === 'recurring' ? (
                      <span className={`text-sm font-medium ${
                        task.due_status === 'overdue' ? 'text-red-600' :
                        task.due_status === 'due-soon' ? 'text-amber-600' : 'text-green-600'
                      }`}>
                        {task.due_status === 'overdue' ? 'Überfällig' :
                         task.due_status === 'due-soon' ? 'Bald fällig' : 'OK'}
                      </span>
                    ) : (
                      <span className="text-sm text-gray-600">{task.status || 'offen'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-garden-600 font-medium">
                    {task.credit_value ? `${task.credit_value}€` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sortedTasks.length === 0 && (
          <div className="text-center py-8 text-gray-500">Keine Aufgaben gefunden</div>
        )}
      </div>
    );
  };

  // Stats
  const filteredTasks = getFilteredTasks();
  const stats = {
    overdue: filteredTasks.filter(t => t.due_status === 'overdue').length,
    dueSoon: filteredTasks.filter(t => t.due_status === 'due-soon').length,
    ok: filteredTasks.filter(t => t.due_status === 'ok' || !t.due_status).length,
    total: filteredTasks.length,
  };

  const isAuthenticated = !!user;
  const isAdmin = user?.role === 'admin';

  return (
    <div className="space-y-6">
      {/* Header with Stats */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Wartungsaufgaben</h2>
            <p className="text-gray-600">Alle wiederkehrenden und einmaligen Aufgaben</p>
          </div>
          <div className="flex gap-2">
            {isAuthenticated && (
              <button
                onClick={() => setShowIssueModal(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition"
              >
                ⚠️ Mangel melden
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-red-50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
            <div className="text-sm text-red-700">Überfällig</div>
          </div>
          <div className="bg-amber-50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.dueSoon}</div>
            <div className="text-sm text-amber-700">Bald fällig</div>
          </div>
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.ok}</div>
            <div className="text-sm text-green-700">In Ordnung</div>
          </div>
          <div className="bg-garden-50 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-garden-600">{stats.total}</div>
            <div className="text-sm text-garden-700">Gesamt</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <MultiSelectFilter
            label="Kategorie"
            options={filters.categories}
            selected={filterCategories}
            onChange={setFilterCategories}
            isOpen={showCategoryFilter}
            onToggle={() => {
              setShowCategoryFilter(!showCategoryFilter);
              setShowEffortFilter(false);
              setShowTypeFilter(false);
              setShowStatusFilter(false);
            }}
            renderOption={(opt) => `${CATEGORY_CONFIG[opt]?.emoji || ''} ${CATEGORY_CONFIG[opt]?.label || opt}`}
          />

          <MultiSelectFilter
            label="Aufwand"
            options={['leicht', 'mittel', 'schwer']}
            selected={filterEfforts}
            onChange={setFilterEfforts}
            isOpen={showEffortFilter}
            onToggle={() => {
              setShowEffortFilter(!showEffortFilter);
              setShowCategoryFilter(false);
              setShowTypeFilter(false);
              setShowStatusFilter(false);
            }}
          />

          <MultiSelectFilter
            label="Typ"
            options={['recurring', 'project']}
            selected={filterTypes}
            onChange={setFilterTypes}
            isOpen={showTypeFilter}
            onToggle={() => {
              setShowTypeFilter(!showTypeFilter);
              setShowCategoryFilter(false);
              setShowEffortFilter(false);
              setShowStatusFilter(false);
            }}
            renderOption={(opt) => opt === 'recurring' ? '🔄 Wiederkehrend' : '📋 Projekt'}
          />

          <MultiSelectFilter
            label="Status"
            options={['overdue', 'due-soon', 'ok', 'offen', 'next', 'in_progress', 'done']}
            selected={filterStatuses}
            onChange={setFilterStatuses}
            isOpen={showStatusFilter}
            onToggle={() => {
              setShowStatusFilter(!showStatusFilter);
              setShowCategoryFilter(false);
              setShowEffortFilter(false);
              setShowTypeFilter(false);
            }}
            renderOption={(opt) => {
              const labels: Record<string, string> = {
                overdue: '⚠️ Überfällig',
                'due-soon': '⏰ Bald fällig',
                ok: '✓ OK',
                offen: 'Offen',
                next: 'Als Nächstes',
                in_progress: 'In Arbeit',
                done: 'Erledigt'
              };
              return labels[opt] || opt;
            }}
          />

          {(filterCategories.length > 0 || filterEfforts.length > 0 || filterTypes.length > 0 || filterStatuses.length > 0) && (
            <button
              onClick={() => {
                setFilterCategories([]);
                setFilterEfforts([]);
                setFilterTypes([]);
                setFilterStatuses([]);
              }}
              className="px-3 py-2 text-sm text-red-600 hover:text-red-700"
            >
              Alle Filter zurücksetzen
            </button>
          )}

          <div className="flex-1" />

          {/* View Toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('kanban')}
              className={`px-3 py-1 rounded text-sm font-medium transition ${
                viewMode === 'kanban' ? 'bg-white shadow text-garden-600' : 'text-gray-600'
              }`}
            >
              📋 Kanban
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 rounded text-sm font-medium transition ${
                viewMode === 'list' ? 'bg-white shadow text-garden-600' : 'text-gray-600'
              }`}
            >
              📝 Liste
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-garden-600 mx-auto mb-4" />
          <p className="text-gray-600">Lade Aufgaben...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg text-center">
          {error}
        </div>
      ) : viewMode === 'kanban' ? (
        renderKanbanView()
      ) : (
        renderListView()
      )}

      {/* Modals */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onComplete={handleCompleteTask}
          onStatusChange={handleStatusChange}
          isAuthenticated={isAuthenticated}
          isAdmin={isAdmin}
        />
      )}

      {showIssueModal && (
        <IssueReportModal
          isOpen={showIssueModal}
          onClose={() => setShowIssueModal(false)}
          onSuccess={() => {
            setShowIssueModal(false);
          }}
        />
      )}
    </div>
  );
}
