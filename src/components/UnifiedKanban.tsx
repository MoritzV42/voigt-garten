import { useState, useEffect, useRef, useCallback } from 'react';
import TaskDetailModal from './TaskDetailModal';
import IssueReportModal from './IssueReportModal';


interface User {
  id: number;
  email: string;
  username?: string;
  name?: string;
  role: 'user' | 'admin';
}

interface Assignee {
  id: number;
  name: string;
  email?: string;
  type: 'user' | 'provider';
  category?: string;
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
  // New fields
  is_recurring?: boolean;
  parent_task_id?: number;
  due_date?: string;
  dependencies?: number[];
  assigned_to_list?: Assignee[];
  comment_count?: number;
  children_count?: number;
  has_blockers?: boolean;
  map_area?: string;
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
  rechtliches: { emoji: '⚖️', label: 'Rechtliches', color: 'bg-rose-100 text-rose-800' },
  it: { emoji: '💻', label: 'IT & Bugs', color: 'bg-indigo-100 text-indigo-800' },
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

type SortField = 'title' | 'category' | 'task_type' | 'status' | 'credit_value' | 'due_date' | 'priority' | 'created_at';
type SortOrder = 'asc' | 'desc';
type ViewMode = 'kanban' | 'list';

const PROVIDER_CATEGORY_ICONS: Record<string, string> = {
  'Elektriker': '⚡',
  'Klempner': '🔧',
  'Gärtner': '🌱',
  'Maler': '🎨',
  'Schreiner': '🪵',
  'Dachdecker': '🏠',
};

export default function UnifiedKanban() {
  const [user, setUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filters, setFilters] = useState<Filters>({ categories: [], efforts: [], assignees: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Multi-select filters
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterEfforts, setFilterEfforts] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterPriorities, setFilterPriorities] = useState<string[]>([]);
  const [filterAssignees, setFilterAssignees] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Assignees list for filter
  const [allAssignees, setAllAssignees] = useState<Assignee[]>([]);

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
  const [showPriorityFilter, setShowPriorityFilter] = useState(false);
  const [showAssigneeFilter, setShowAssigneeFilter] = useState(false);

  // Mobile Kanban tab
  const [mobileActiveTab, setMobileActiveTab] = useState('offen');

  // Map area filter (from URL hash)
  const [mapAreaFilter, setMapAreaFilter] = useState<string | null>(null);

  const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

  // Listen to URL hash for map area filter
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const match = hash.match(/#area=([^&]+)/);
      setMapAreaFilter(match ? decodeURIComponent(match[1]) : null);
    };
    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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
    fetchAssignees();
  }, [mapAreaFilter]);

  const fetchTasks = async () => {
    setIsLoading(true);
    try {
      let url = `${API_URL}/api/tasks/unified`;
      if (mapAreaFilter) url += `?map_area=${encodeURIComponent(mapAreaFilter)}`;
      const response = await fetch(url);
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

  const fetchAssignees = async () => {
    try {
      const response = await fetch(`${API_URL}/api/assignees`);
      if (response.ok) {
        const data = await response.json();
        setAllAssignees(data.assignees || []);
      }
    } catch {
      // Silently fail - assignees filter just won't be populated
    }
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

  const handleTaskUpdate = async (taskId: number, updates: Record<string, any>) => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    try {
      const response = await fetch(`${API_URL}/api/projects/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        fetchTasks();
      }
    } catch (err) {
      console.error('Error updating task:', err);
    }
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, task: Task) => {
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

    if (!draggedTask) {
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
  const getFilteredTasks = useCallback(() => {
    return tasks.filter(task => {
      // Search filter
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        // #ID search
        if (q.startsWith('#') && task.task_type === 'project') {
          const idStr = q.slice(1);
          if (!task.id.toString().startsWith(idStr)) return false;
        } else {
          const matchTitle = task.title.toLowerCase().includes(q);
          const matchDesc = task.description?.toLowerCase().includes(q);
          if (!matchTitle && !matchDesc) return false;
        }
      }

      if (filterCategories.length > 0 && !filterCategories.includes(task.category)) return false;
      if (filterEfforts.length > 0 && task.effort && !filterEfforts.includes(task.effort)) return false;
      if (filterTypes.length > 0 && !filterTypes.includes(task.task_type)) return false;
      if (filterPriorities.length > 0 && task.priority && !filterPriorities.includes(task.priority)) return false;

      // Assignee filter
      if (filterAssignees.length > 0) {
        if (filterAssignees.includes('unassigned')) {
          const hasAssignee = (task.assigned_to_list && task.assigned_to_list.length > 0) || task.assigned_to;
          if (hasAssignee) {
            // Check if any selected assignee (other than unassigned) matches
            const otherFilters = filterAssignees.filter(a => a !== 'unassigned');
            if (otherFilters.length === 0) return false;
            const assigneeNames = (task.assigned_to_list || []).map(a => a.name);
            if (task.assigned_to) assigneeNames.push(task.assigned_to);
            if (!otherFilters.some(f => assigneeNames.includes(f))) return false;
          }
        } else {
          const assigneeNames = (task.assigned_to_list || []).map(a => a.name);
          if (task.assigned_to) assigneeNames.push(task.assigned_to);
          if (!filterAssignees.some(f => assigneeNames.includes(f))) return false;
        }
      }

      if (filterStatuses.length > 0) {
        const status = task.status;
        if (status && !filterStatuses.includes(status)) return false;
      }
      return true;
    });
  }, [tasks, debouncedSearch, filterCategories, filterEfforts, filterTypes, filterStatuses, filterPriorities, filterAssignees]);

  // Sort tasks
  const getSortedTasks = (tasksToSort: Task[]) => {
    const priorityOrder: Record<string, number> = { kritisch: 0, hoch: 1, mittel: 2, niedrig: 3 };
    return [...tasksToSort].sort((a, b) => {
      let aVal: any = a[sortField as keyof Task];
      let bVal: any = b[sortField as keyof Task];

      if (sortField === 'status') {
        aVal = a.status;
        bVal = b.status;
      }

      if (sortField === 'priority') {
        aVal = priorityOrder[a.priority || 'mittel'] ?? 2;
        bVal = priorityOrder[b.priority || 'mittel'] ?? 2;
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
    return filtered.filter(t => (t.status || 'offen') === status);
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
          className={`px-3 py-2 border rounded-lg text-sm flex items-center gap-2 transition min-h-[44px] ${
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
          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[200px] py-2 max-h-60 overflow-y-auto">
            {options.map(opt => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer min-h-[44px]"
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
                className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100 mt-1 min-h-[44px]"
              >
                Alle abwählen
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const closeAllFilters = () => {
    setShowCategoryFilter(false);
    setShowEffortFilter(false);
    setShowTypeFilter(false);
    setShowStatusFilter(false);
    setShowPriorityFilter(false);
    setShowAssigneeFilter(false);
  };

  const activeFilterCount = [filterCategories, filterEfforts, filterTypes, filterStatuses, filterPriorities, filterAssignees]
    .filter(f => f.length > 0).length;

  const renderAssigneeAvatars = (task: Task) => {
    const assignees = task.assigned_to_list || [];
    if (assignees.length === 0 && !task.assigned_to) return null;

    const displayAssignees = assignees.length > 0 ? assignees : task.assigned_to ? [{ id: 0, name: task.assigned_to, type: 'user' as const }] : [];
    const shown = displayAssignees.slice(0, 3);
    const overflow = displayAssignees.length - 3;

    return (
      <div className="flex items-center -space-x-1 mt-2">
        {shown.map((a, i) => {
          const initials = a.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
          const isProvider = a.type === 'provider';
          return (
            <div
              key={i}
              title={`${a.name}${isProvider && a.category ? ` (${a.category})` : ''}`}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium border-2 border-white ${
                isProvider ? 'bg-blue-100 text-blue-700' : 'bg-garden-100 text-garden-700'
              }`}
            >
              {isProvider && a.category && PROVIDER_CATEGORY_ICONS[a.category]
                ? PROVIDER_CATEGORY_ICONS[a.category]
                : initials}
            </div>
          );
        })}
        {overflow > 0 && (
          <div className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px] font-medium border-2 border-white">
            +{overflow}
          </div>
        )}
      </div>
    );
  };

  const renderTaskCard = (task: Task, draggable: boolean = false) => {
    const category = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.sonstiges;
    const priorityClass = task.priority ? PRIORITY_COLORS[task.priority] : 'border-l-gray-300';
    const isDragging = draggedTask?.id === task.id && draggedTask?.task_type === task.task_type;
    const isBlocked = task.has_blockers;

    return (
      <div
        key={`${task.task_type}-${task.id}`}
        draggable={draggable}
        onDragStart={(e) => handleDragStart(e, task)}
        onDragEnd={handleDragEnd}
        onClick={() => handleTaskClick(task)}
        className={`p-4 rounded-lg border-l-4 ${priorityClass} shadow-sm hover:shadow-md transition cursor-pointer mb-3 ${
          isDragging ? 'opacity-50' : ''
        } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${
          isBlocked ? 'ring-2 ring-red-300' : ''
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {isBlocked && <span className="text-red-500 text-xs shrink-0" title="Blockiert">🔒</span>}
            <h4 className="font-medium text-gray-900 text-sm truncate">{task.title}</h4>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {task.comment_count && task.comment_count > 0 && (
              <span className="text-xs text-gray-500 flex items-center gap-0.5" title={`${task.comment_count} Kommentare`}>
                💬{task.comment_count}
              </span>
            )}
            {task.is_recurring && task.cycle_days && (
              <span className="text-xs text-blue-600" title={`Alle ${task.cycle_days} Tage`}>
                🔄 {task.cycle_days}d
              </span>
            )}
          </div>
        </div>

        {/* Category Badge */}
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${category.color}`}>
          {category.emoji} {category.label}
        </span>

        {/* Subtask Progress */}
        {task.children_count && task.children_count > 0 && (
          <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            {task.children_count} Subtasks
          </div>
        )}

        {/* Due Status for Recurring */}
        {task.is_recurring && task.due_status && (
          <div className={`mt-2 text-xs font-medium ${
            task.due_status === 'overdue' ? 'text-red-600' :
            task.due_status === 'due-soon' ? 'text-amber-600' : 'text-green-600'
          }`}>
            {task.due_status === 'overdue' ? '⚠️ Überfällig' :
             task.due_status === 'due-soon' ? '⏰ Bald fällig' : '✓ OK'}
          </div>
        )}

        {/* Due Date */}
        {!task.is_recurring && task.due_date && (
          <div className="mt-2 text-xs text-gray-500">
            📅 {new Date(task.due_date).toLocaleDateString('de-DE')}
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

        {/* Assignee Avatars */}
        {renderAssigneeAvatars(task)}
      </div>
    );
  };

  const renderKanbanView = () => {
    // Check if mobile
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    if (isMobile) {
      return (
        <div>
          {/* Tab switching for mobile */}
          <div className="flex overflow-x-auto gap-1 mb-4 pb-1">
            {STATUS_COLUMNS.map(col => {
              const count = getTasksByStatus(col.id).length;
              return (
                <button
                  key={col.id}
                  onClick={() => setMobileActiveTab(col.id)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition min-h-[44px] ${
                    mobileActiveTab === col.id
                      ? 'bg-garden-600 text-white'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {col.label} ({count})
                </button>
              );
            })}
          </div>
          <div className="space-y-3">
            {getTasksByStatus(mobileActiveTab).map(task => renderTaskCard(task, false))}
            {getTasksByStatus(mobileActiveTab).length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">Keine Aufgaben</p>
            )}
          </div>
        </div>
      );
    }

    return (
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
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <span className="text-gray-300 ml-1">↕</span>;
    }
    return <span className="text-garden-600 ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  const renderListView = () => {
    const sortedTasks = getSortedTasks(getFilteredTasks());

    return (
      <div className="bg-white rounded-xl shadow overflow-hidden overflow-x-auto">
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
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none hidden sm:table-cell"
              >
                Kategorie <SortIcon field="category" />
              </th>
              <th
                onClick={() => handleSort('priority')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none hidden md:table-cell"
              >
                Priorität <SortIcon field="priority" />
              </th>
              <th
                onClick={() => handleSort('status')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
              >
                Status <SortIcon field="status" />
              </th>
              <th
                onClick={() => handleSort('due_date')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none hidden lg:table-cell"
              >
                Fällig <SortIcon field="due_date" />
              </th>
              <th
                onClick={() => handleSort('credit_value')}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none hidden sm:table-cell"
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
                  className={`hover:bg-gray-50 cursor-pointer ${task.has_blockers ? 'bg-red-50/30' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {task.has_blockers && <span className="text-red-500 text-xs">🔒</span>}
                      <div>
                        <div className="font-medium text-gray-900">{task.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {task.is_recurring && task.cycle_days && (
                            <span className="text-xs text-blue-600">🔄 {task.cycle_days}d</span>
                          )}
                          {task.comment_count && task.comment_count > 0 && (
                            <span className="text-xs text-gray-400">💬{task.comment_count}</span>
                          )}
                          {task.children_count && task.children_count > 0 && (
                            <span className="text-xs text-gray-400">📋{task.children_count}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${category.color}`}>
                      {category.emoji} {category.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {task.priority && (
                      <span className={`text-xs font-medium ${
                        task.priority === 'kritisch' ? 'text-red-600' :
                        task.priority === 'hoch' ? 'text-amber-600' :
                        task.priority === 'mittel' ? 'text-blue-600' : 'text-green-600'
                      }`}>
                        {task.priority}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600">{task.status || 'offen'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell">
                    {task.due_date ? new Date(task.due_date).toLocaleDateString('de-DE') :
                     task.next_due ? new Date(task.next_due).toLocaleDateString('de-DE') : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-garden-600 font-medium hidden sm:table-cell">
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
      <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Wartungsaufgaben</h2>
            <p className="text-gray-600">Alle wiederkehrenden und einmaligen Aufgaben</p>
          </div>
          <div className="flex gap-2">
            {isAuthenticated && (
              <button
                onClick={() => setShowIssueModal(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition min-h-[44px]"
              >
                ⚠️ Mangel melden
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-red-50 rounded-lg p-3 sm:p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
            <div className="text-sm text-red-700">Überfällig</div>
          </div>
          <div className="bg-amber-50 rounded-lg p-3 sm:p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.dueSoon}</div>
            <div className="text-sm text-amber-700">Bald fällig</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3 sm:p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{stats.ok}</div>
            <div className="text-sm text-green-700">In Ordnung</div>
          </div>
          <div className="bg-garden-50 rounded-lg p-3 sm:p-4 text-center">
            <div className="text-2xl font-bold text-garden-600">{stats.total}</div>
            <div className="text-sm text-garden-700">Gesamt</div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Suche... (#123 für ID)"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 text-sm min-h-[44px]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Filter Toggle (Mobile) */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="md:hidden w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 flex items-center justify-between mb-3 min-h-[44px]"
        >
          <span>Filter {activeFilterCount > 0 ? `(${activeFilterCount} aktiv)` : ''}</span>
          <svg className={`w-4 h-4 transition ${showFilters ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Filters */}
        <div className={`flex-wrap gap-3 items-center ${showFilters ? 'flex' : 'hidden md:flex'}`}>
          <MultiSelectFilter
            label="Kategorie"
            options={filters.categories}
            selected={filterCategories}
            onChange={setFilterCategories}
            isOpen={showCategoryFilter}
            onToggle={() => {
              closeAllFilters();
              setShowCategoryFilter(!showCategoryFilter);
            }}
            renderOption={(opt) => `${CATEGORY_CONFIG[opt]?.emoji || ''} ${CATEGORY_CONFIG[opt]?.label || opt}`}
          />

          <MultiSelectFilter
            label="Priorität"
            options={['kritisch', 'hoch', 'mittel', 'niedrig']}
            selected={filterPriorities}
            onChange={setFilterPriorities}
            isOpen={showPriorityFilter}
            onToggle={() => {
              closeAllFilters();
              setShowPriorityFilter(!showPriorityFilter);
            }}
            renderOption={(opt) => {
              const icons: Record<string, string> = { kritisch: '🔴', hoch: '🟠', mittel: '🔵', niedrig: '🟢' };
              return `${icons[opt] || ''} ${opt.charAt(0).toUpperCase() + opt.slice(1)}`;
            }}
          />

          <MultiSelectFilter
            label="Zuweisung"
            options={['unassigned', ...allAssignees.map(a => a.name)]}
            selected={filterAssignees}
            onChange={setFilterAssignees}
            isOpen={showAssigneeFilter}
            onToggle={() => {
              closeAllFilters();
              setShowAssigneeFilter(!showAssigneeFilter);
            }}
            renderOption={(opt) => opt === 'unassigned' ? 'Nicht zugewiesen' : opt}
          />

          <MultiSelectFilter
            label="Aufwand"
            options={['leicht', 'mittel', 'schwer']}
            selected={filterEfforts}
            onChange={setFilterEfforts}
            isOpen={showEffortFilter}
            onToggle={() => {
              closeAllFilters();
              setShowEffortFilter(!showEffortFilter);
            }}
          />

          <MultiSelectFilter
            label="Typ"
            options={['recurring', 'project']}
            selected={filterTypes}
            onChange={setFilterTypes}
            isOpen={showTypeFilter}
            onToggle={() => {
              closeAllFilters();
              setShowTypeFilter(!showTypeFilter);
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
              closeAllFilters();
              setShowStatusFilter(!showStatusFilter);
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

          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setFilterCategories([]);
                setFilterEfforts([]);
                setFilterTypes([]);
                setFilterStatuses([]);
                setFilterPriorities([]);
                setFilterAssignees([]);
              }}
              className="px-3 py-2 text-sm text-red-600 hover:text-red-700 min-h-[44px]"
            >
              Alle Filter zurücksetzen
            </button>
          )}

          {mapAreaFilter && (
            <button
              onClick={() => { window.location.hash = ''; setMapAreaFilter(null); }}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-garden-100 text-garden-800 hover:bg-garden-200 min-h-[44px]"
            >
              Bereich: {mapAreaFilter}
              <span className="ml-1">&times;</span>
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
              title="Kanban"
            >
              📋 Kanban
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 rounded text-sm font-medium transition ${
                viewMode === 'list' ? 'bg-white shadow text-garden-600' : 'text-gray-600'
              }`}
              title="Liste"
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

      {/* FAB for mobile - New Task */}
      {isAuthenticated && isAdmin && (
        <div className="fixed bottom-6 right-6 md:hidden z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <button
            onClick={() => setShowIssueModal(true)}
            className="w-14 h-14 bg-garden-600 hover:bg-garden-700 text-white rounded-full shadow-lg flex items-center justify-center text-2xl transition"
          >
            +
          </button>
        </div>
      )}

      {/* Modals */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={!!selectedTask}
          onClose={() => setSelectedTask(null)}
          onComplete={handleCompleteTask}
          onStatusChange={handleStatusChange}
          onTaskUpdate={handleTaskUpdate}
          isAuthenticated={isAuthenticated}
          isAdmin={isAdmin}
          allAssignees={allAssignees}
          onRefresh={fetchTasks}
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
