import { useState, useRef, useEffect } from 'react';

interface Assignee {
  id: number;
  name: string;
  email?: string;
  type: 'user' | 'provider';
  category?: string;
}

interface Comment {
  id: number;
  user_email: string;
  user_name?: string;
  comment: string;
  created_at: string;
}

interface SubTask {
  id: number;
  title: string;
  status?: string;
  assigned_to_list?: Assignee[];
  due_date?: string;
  children?: SubTask[];
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
  parent_task_id?: number;
  start_date?: string;
  due_date?: string;
  dependencies?: number[];
  assigned_to_list?: Assignee[];
  comment_count?: number;
  children_count?: number;
  has_blockers?: boolean;
  map_area?: string;
}

interface Props {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (taskId: number, taskType: string, notes?: string, photo?: File) => void;
  onStatusChange: (taskId: number, status: string) => void;
  onTaskUpdate?: (taskId: number, updates: Record<string, any>) => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
  allAssignees?: Assignee[];
  onRefresh?: () => void;
}

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

const PROVIDER_CATEGORY_ICONS: Record<string, string> = {
  'Elektriker': '⚡',
  'Klempner': '🔧',
  'Gärtner': '🌱',
  'Maler': '🎨',
  'Schreiner': '🪵',
  'Dachdecker': '🏠',
};

const TOKEN_KEY = 'voigt-garten-token';

export default function TaskDetailModal({
  task,
  isOpen,
  onClose,
  onComplete,
  onStatusChange,
  onTaskUpdate,
  isAuthenticated,
  isAdmin,
  allAssignees = [],
  onRefresh
}: Props) {
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subtasks
  const [subtasks, setSubtasks] = useState<SubTask[]>([]);
  const [showAddSubtask, setShowAddSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // Dependencies
  const [blockers, setBlockers] = useState<{ id: number; title: string; status: string }[]>([]);
  const [showAddDep, setShowAddDep] = useState(false);
  const [depSearch, setDepSearch] = useState('');
  const [depResults, setDepResults] = useState<{ id: number; title: string; status: string }[]>([]);

  // Comments
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Assignee picker
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [selectedAssignees, setSelectedAssignees] = useState<Assignee[]>(task.assigned_to_list || []);

  // Dates
  const [startDate, setStartDate] = useState(task.start_date || '');
  const [dueDate, setDueDate] = useState(task.due_date || '');

  const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

  useEffect(() => {
    if (isOpen && task.task_type === 'project') {
      loadSubtasks();
      loadBlockers();
    }
    if (isOpen) {
      loadComments();
    }
    setSelectedAssignees(task.assigned_to_list || []);
    setStartDate(task.start_date || '');
    setDueDate(task.due_date || '');
  }, [isOpen, task.id]);

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  const loadSubtasks = async () => {
    try {
      const res = await fetch(`${API_URL}/api/projects/${task.id}/subtasks?recursive=true`);
      if (res.ok) {
        const data = await res.json();
        setSubtasks(data.subtasks || []);
      }
    } catch { /* ignore */ }
  };

  const loadBlockers = async () => {
    try {
      const res = await fetch(`${API_URL}/api/projects/${task.id}/blockers`);
      if (res.ok) {
        const data = await res.json();
        setBlockers(data.blockers || []);
      }
    } catch { /* ignore */ }
  };

  const loadComments = async () => {
    try {
      const res = await fetch(`${API_URL}/api/tasks/${task.task_type}/${task.id}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch { /* ignore */ }
  };

  if (!isOpen) return null;

  const category = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.sonstiges;

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleComplete = async () => {
    if (task.has_blockers && blockers.length > 0) {
      const proceed = confirm('Diese Aufgabe hat offene Blocker. Trotzdem als erledigt markieren?');
      if (!proceed) return;
    }
    setIsSubmitting(true);
    await onComplete(task.id, task.task_type, notes, photo || undefined);
    setIsSubmitting(false);
    setNotes('');
    setPhoto(null);
    setPhotoPreview(null);
  };

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_URL}/api/projects/${task.id}/subtasks`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newSubtaskTitle, category: task.category })
      });
      if (res.ok) {
        setNewSubtaskTitle('');
        setShowAddSubtask(false);
        loadSubtasks();
        onRefresh?.();
      }
    } catch { /* ignore */ }
  };

  const handleToggleSubtask = async (subtask: SubTask) => {
    const token = getToken();
    if (!token) return;
    const newStatus = subtask.status === 'done' ? 'offen' : 'done';

    try {
      if (newStatus === 'done') {
        await fetch(`${API_URL}/api/projects/${subtask.id}/complete`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
      } else {
        await fetch(`${API_URL}/api/projects/${subtask.id}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'offen' })
        });
      }
      loadSubtasks();
      onRefresh?.();
    } catch { /* ignore */ }
  };

  const handleAddDependency = async (depId: number) => {
    const token = getToken();
    if (!token) return;

    const currentDeps = task.dependencies || [];
    if (currentDeps.includes(depId)) return;

    try {
      const res = await fetch(`${API_URL}/api/projects/${task.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependencies: JSON.stringify([...currentDeps, depId]) })
      });
      if (res.ok) {
        setShowAddDep(false);
        setDepSearch('');
        loadBlockers();
        onRefresh?.();
      } else {
        const data = await res.json();
        alert(data.error || 'Fehler beim Hinzufügen');
      }
    } catch { /* ignore */ }
  };

  const handleRemoveDependency = async (depId: number) => {
    const token = getToken();
    if (!token) return;

    const currentDeps = task.dependencies || [];
    const newDeps = currentDeps.filter(d => d !== depId);

    try {
      await fetch(`${API_URL}/api/projects/${task.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependencies: JSON.stringify(newDeps) })
      });
      loadBlockers();
      onRefresh?.();
    } catch { /* ignore */ }
  };

  const searchDependencies = async (query: string) => {
    if (query.length < 2) { setDepResults([]); return; }
    try {
      const res = await fetch(`${API_URL}/api/tasks/unified?search=${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        const results = (data.tasks || [])
          .filter((t: any) => t.task_type === 'project' && t.id !== task.id && !(task.dependencies || []).includes(t.id))
          .slice(0, 5)
          .map((t: any) => ({ id: t.id, title: t.title, status: t.status || 'offen' }));
        setDepResults(results);
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (depSearch.length >= 2) {
      const timer = setTimeout(() => searchDependencies(depSearch), 300);
      return () => clearTimeout(timer);
    } else {
      setDepResults([]);
    }
  }, [depSearch]);

  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    const token = getToken();
    if (!token) return;

    setIsPostingComment(true);
    try {
      const res = await fetch(`${API_URL}/api/tasks/${task.task_type}/${task.id}/comments`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: newComment })
      });
      if (res.ok) {
        setNewComment('');
        loadComments();
        onRefresh?.();
      }
    } catch { /* ignore */ }
    setIsPostingComment(false);
  };

  const handleDeleteComment = async (commentId: number) => {
    const token = getToken();
    if (!token) return;
    if (!confirm('Kommentar löschen?')) return;

    try {
      await fetch(`${API_URL}/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      loadComments();
    } catch { /* ignore */ }
  };

  const handleAssigneeToggle = (assignee: Assignee) => {
    const exists = selectedAssignees.find(a => a.id === assignee.id && a.type === assignee.type);
    let newList: Assignee[];
    if (exists) {
      newList = selectedAssignees.filter(a => !(a.id === assignee.id && a.type === assignee.type));
    } else {
      newList = [...selectedAssignees, assignee];
    }
    setSelectedAssignees(newList);

    // Save immediately
    if (onTaskUpdate && task.task_type === 'project') {
      onTaskUpdate(task.id, { assigned_to_list: JSON.stringify(newList) });
    }
  };

  const handleDateChange = (field: 'start_date' | 'due_date', value: string) => {
    if (field === 'start_date') setStartDate(value);
    else setDueDate(value);

    if (onTaskUpdate && task.task_type === 'project') {
      onTaskUpdate(task.id, { [field]: value || null });
    }
  };

  const filteredAssignees = allAssignees.filter(a => {
    const q = assigneeSearch.toLowerCase();
    return a.name.toLowerCase().includes(q)
      || (a.email?.toLowerCase().includes(q))
      || (a.category?.toLowerCase().includes(q));
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  const renderSubtaskItem = (subtask: SubTask, level: number = 0) => (
    <div key={subtask.id}>
      <div
        className={`flex items-center gap-2 py-2 px-2 hover:bg-gray-50 rounded`}
        style={{ marginLeft: `${level * 16}px` }}
      >
        <input
          type="checkbox"
          checked={subtask.status === 'done'}
          onChange={() => handleToggleSubtask(subtask)}
          className="rounded border-gray-300 text-garden-600 focus:ring-garden-500 w-5 h-5"
          disabled={!isAuthenticated}
        />
        <span className={`flex-1 text-sm ${subtask.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
          {subtask.title}
        </span>
        {subtask.due_date && (
          <span className="text-xs text-gray-400">{new Date(subtask.due_date).toLocaleDateString('de-DE')}</span>
        )}
      </div>
      {subtask.children?.map(child => renderSubtaskItem(child, Math.min(level + 1, 4)))}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-t-xl sm:rounded-xl shadow-2xl w-full sm:max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-start justify-between z-10">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-sm px-3 py-1 rounded-full ${category.color}`}>
                {category.emoji} {category.label}
              </span>
              {task.task_type === 'recurring' && (
                <span className="text-sm bg-purple-100 text-purple-700 px-3 py-1 rounded-full">
                  🔄 Alle {task.cycle_days} Tage
                </span>
              )}
              {task.has_blockers && (
                <span className="text-sm bg-red-100 text-red-700 px-3 py-1 rounded-full">
                  🔒 Blockiert
                </span>
              )}
              {task.map_area && (
                <span className="text-sm bg-garden-100 text-garden-800 px-3 py-1 rounded-full capitalize">
                  📍 {task.map_area.replace(/-/g, ' ')}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-gray-900">{task.title}</h2>
            {task.task_type === 'project' && (
              <span className="text-xs text-gray-400">#{task.id}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-2 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 space-y-6 flex-1 overflow-y-auto">
          {/* Description */}
          {task.description && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Beschreibung</h3>
              <p className="text-gray-700 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Details Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {task.credit_value !== undefined && task.credit_value > 0 && (
              <div className="bg-garden-50 rounded-lg p-3">
                <div className="text-sm text-garden-600">Guthaben</div>
                <div className="text-lg font-bold text-garden-700">💰 {task.credit_value}€</div>
              </div>
            )}

            {task.effort && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm text-gray-500">Aufwand</div>
                <div className="text-lg font-medium text-gray-700">{task.effort}</div>
              </div>
            )}

            {task.priority && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm text-gray-500">Priorität</div>
                <div className={`text-lg font-medium ${
                  task.priority === 'kritisch' ? 'text-red-600' :
                  task.priority === 'hoch' ? 'text-amber-600' :
                  task.priority === 'mittel' ? 'text-blue-600' : 'text-green-600'
                }`}>
                  {task.priority}
                </div>
              </div>
            )}

            {task.estimated_cost && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm text-gray-500">Geschätzte Kosten</div>
                <div className="text-lg font-medium text-gray-700">{task.estimated_cost}</div>
              </div>
            )}

            {task.next_due && (
              <div className={`rounded-lg p-3 ${
                task.due_status === 'overdue' ? 'bg-red-50' :
                task.due_status === 'due-soon' ? 'bg-amber-50' : 'bg-green-50'
              }`}>
                <div className={`text-sm ${
                  task.due_status === 'overdue' ? 'text-red-600' :
                  task.due_status === 'due-soon' ? 'text-amber-600' : 'text-green-600'
                }`}>Nächste Fälligkeit</div>
                <div className={`text-lg font-medium ${
                  task.due_status === 'overdue' ? 'text-red-700' :
                  task.due_status === 'due-soon' ? 'text-amber-700' : 'text-green-700'
                }`}>
                  {new Date(task.next_due).toLocaleDateString('de-DE')}
                </div>
              </div>
            )}
          </div>

          {/* Date Pickers (Projects only) */}
          {task.task_type === 'project' && isAdmin && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Zeitraum</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Startdatum</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => handleDateChange('start_date', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-garden-500 min-h-[44px]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Enddatum</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => handleDateChange('due_date', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-garden-500 min-h-[44px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Multi-Assign (Projects only) */}
          {task.task_type === 'project' && isAdmin && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Zuweisung</h3>
              {/* Selected assignees as chips */}
              <div className="flex flex-wrap gap-2 mb-2">
                {selectedAssignees.map((a, i) => (
                  <span
                    key={`${a.type}-${a.id}-${i}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                      a.type === 'provider' ? 'bg-blue-100 text-blue-700' : 'bg-garden-100 text-garden-700'
                    }`}
                  >
                    {a.type === 'provider' && a.category && PROVIDER_CATEGORY_ICONS[a.category]
                      ? `${PROVIDER_CATEGORY_ICONS[a.category]} ` : ''}
                    {a.name}
                    <button
                      onClick={() => handleAssigneeToggle(a)}
                      className="hover:text-red-500 ml-1"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={assigneeSearch}
                  onChange={(e) => { setAssigneeSearch(e.target.value); setShowAssigneePicker(true); }}
                  onFocus={() => setShowAssigneePicker(true)}
                  placeholder="Person oder Dienstleister suchen..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-garden-500 min-h-[44px]"
                />
                {showAssigneePicker && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-48 overflow-y-auto">
                    {filteredAssignees.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">Keine Ergebnisse</div>
                    ) : filteredAssignees.map(a => {
                      const isSelected = selectedAssignees.some(s => s.id === a.id && s.type === a.type);
                      return (
                        <button
                          key={`${a.type}-${a.id}`}
                          onClick={() => { handleAssigneeToggle(a); setShowAssigneePicker(false); setAssigneeSearch(''); }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 min-h-[44px] ${isSelected ? 'bg-garden-50' : ''}`}
                        >
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium ${
                            a.type === 'provider' ? 'bg-blue-100 text-blue-700' : 'bg-garden-100 text-garden-700'
                          }`}>
                            {a.type === 'provider' && a.category && PROVIDER_CATEGORY_ICONS[a.category]
                              ? PROVIDER_CATEGORY_ICONS[a.category]
                              : a.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{a.name}</div>
                            {a.category && <div className="text-xs text-gray-400">{a.category}</div>}
                          </div>
                          {a.type === 'provider' && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Dienstleister</span>
                          )}
                          {isSelected && <span className="text-garden-600">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Non-editable assignee display */}
          {!isAdmin && (selectedAssignees.length > 0 || task.assigned_to) && (
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-sm text-gray-500">Zugewiesen an</div>
              <div className="flex flex-wrap gap-2 mt-1">
                {selectedAssignees.length > 0
                  ? selectedAssignees.map((a, i) => (
                    <span key={i} className="text-sm font-medium text-gray-700">
                      👤 {a.name}{a.type === 'provider' && a.category ? ` (${a.category})` : ''}
                    </span>
                  ))
                  : task.assigned_to && <span className="text-sm font-medium text-gray-700">👤 {task.assigned_to}</span>
                }
              </div>
            </div>
          )}

          {/* Subtasks Section (Projects only) */}
          {task.task_type === 'project' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-500">
                  Subtasks {subtasks.length > 0 && `(${subtasks.filter(s => s.status === 'done').length}/${subtasks.length})`}
                </h3>
                {isAuthenticated && (
                  <button
                    onClick={() => setShowAddSubtask(!showAddSubtask)}
                    className="text-sm text-garden-600 hover:text-garden-700 min-h-[44px] px-2"
                  >
                    + Subtask
                  </button>
                )}
              </div>

              {subtasks.length > 0 && (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                  {subtasks.map(st => renderSubtaskItem(st))}
                </div>
              )}

              {showAddSubtask && (
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSubtask()}
                    placeholder="Subtask-Titel..."
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-garden-500 min-h-[44px]"
                    autoFocus
                  />
                  <button
                    onClick={handleAddSubtask}
                    className="px-4 py-2 bg-garden-600 text-white rounded-lg text-sm hover:bg-garden-700 min-h-[44px]"
                  >
                    Hinzufügen
                  </button>
                </div>
              )}

              {subtasks.length === 0 && !showAddSubtask && (
                <p className="text-sm text-gray-400">Keine Subtasks</p>
              )}
            </div>
          )}

          {/* Dependencies Section (Projects only) */}
          {task.task_type === 'project' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-500">Abhängigkeiten</h3>
                {isAdmin && (
                  <button
                    onClick={() => setShowAddDep(!showAddDep)}
                    className="text-sm text-garden-600 hover:text-garden-700 min-h-[44px] px-2"
                  >
                    + Abhängigkeit
                  </button>
                )}
              </div>

              {blockers.length > 0 && (
                <div className="space-y-2">
                  {blockers.map(b => (
                    <div key={b.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                      <span className={`w-2 h-2 rounded-full ${b.status === 'done' ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="flex-1 text-sm text-gray-700">#{b.id} {b.title}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        b.status === 'done' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {b.status === 'done' ? 'Erledigt' : b.status}
                      </span>
                      {isAdmin && (
                        <button
                          onClick={() => handleRemoveDependency(b.id)}
                          className="text-gray-400 hover:text-red-500 text-sm"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {showAddDep && (
                <div className="mt-2 relative">
                  <input
                    type="text"
                    value={depSearch}
                    onChange={(e) => setDepSearch(e.target.value)}
                    placeholder="Task suchen..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-garden-500 min-h-[44px]"
                    autoFocus
                  />
                  {depResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-40 overflow-y-auto">
                      {depResults.map(r => (
                        <button
                          key={r.id}
                          onClick={() => handleAddDependency(r.id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 min-h-[44px]"
                        >
                          <span className="text-gray-400">#{r.id}</span>
                          <span className="flex-1">{r.title}</span>
                          <span className={`text-xs ${r.status === 'done' ? 'text-green-600' : 'text-gray-400'}`}>
                            {r.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {blockers.length === 0 && !showAddDep && (
                <p className="text-sm text-gray-400">Keine Abhängigkeiten</p>
              )}
            </div>
          )}

          {/* Last Completion Info */}
          {(task.last_completed_at || task.completed_at) && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h3 className="text-sm font-medium text-green-800 mb-2">Letzte Erledigung</h3>
              <div className="text-sm text-green-700">
                <p>📅 {formatDate(task.last_completed_at || task.completed_at)}</p>
                {(task.last_completed_by || task.completed_by) && (
                  <p>👤 {task.last_completed_by || task.completed_by}</p>
                )}
              </div>
            </div>
          )}

          {/* Completion Photo */}
          {task.completion_photo && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Foto der Erledigung</h3>
              <img
                src={`${API_URL}/images/gallery/${task.completion_photo}`}
                alt="Completion"
                className="rounded-lg max-h-64 object-cover"
              />
            </div>
          )}

          {/* Comments Section */}
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-3">
              Kommentare {comments.length > 0 && `(${comments.length})`}
            </h3>

            {comments.length > 0 && (
              <div className="space-y-3 mb-4">
                {comments.map(c => {
                  const initials = (c.user_name || c.user_email).split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                  return (
                    <div key={c.id} className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-garden-100 text-garden-700 flex items-center justify-center text-xs font-medium shrink-0">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{c.user_name || c.user_email}</span>
                          <span className="text-xs text-gray-400">
                            {new Date(c.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {(isAdmin || c.user_email === localStorage.getItem(USER_KEY)) && (
                            <button
                              onClick={() => handleDeleteComment(c.id)}
                              className="text-xs text-gray-400 hover:text-red-500"
                            >
                              🗑
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{c.comment}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {isAuthenticated && (
              <div className="flex gap-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Kommentar schreiben..."
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-garden-500 focus:border-garden-500 resize-none"
                  rows={2}
                />
                <button
                  onClick={handlePostComment}
                  disabled={isPostingComment || !newComment.trim()}
                  className="px-4 py-2 bg-garden-600 hover:bg-garden-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium self-end min-h-[44px]"
                >
                  {isPostingComment ? '...' : 'Senden'}
                </button>
              </div>
            )}
          </div>

          {/* Status Change for Projects (Admin) */}
          {task.task_type === 'project' && isAdmin && task.status !== 'done' && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Status ändern</h3>
              <div className="flex flex-wrap gap-2">
                {['offen', 'next', 'in_progress'].map(status => (
                  <button
                    key={status}
                    onClick={() => onStatusChange(task.id, status)}
                    disabled={task.status === status}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition min-h-[44px] ${
                      task.status === status
                        ? 'bg-garden-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {status === 'offen' ? 'Offen' :
                     status === 'next' ? 'Als Nächstes' : 'In Arbeit'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Complete Task Section */}
          {isAuthenticated && task.status !== 'done' && (
            <div className="border-t border-gray-200 pt-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Als erledigt markieren</h3>

              {task.has_blockers && blockers.some(b => b.status !== 'done') && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                  <p className="text-sm text-red-700">
                    ⚠️ Diese Aufgabe hat offene Blocker. Erledige zuerst die Abhängigkeiten.
                  </p>
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Anmerkungen (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500"
                  rows={3}
                  placeholder="Beschreibe kurz was gemacht wurde..."
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Foto (optional)
                </label>
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-garden-500 transition"
                >
                  {photoPreview ? (
                    <div className="relative">
                      <img src={photoPreview} alt="Preview" className="max-h-48 mx-auto rounded-lg" />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhoto(null);
                          setPhotoPreview(null);
                        }}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-8 h-8 flex items-center justify-center min-w-[44px] min-h-[44px]"
                      >
                        &times;
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-4xl mb-2">📷</div>
                      <p className="text-gray-600">Klicken oder Foto hierher ziehen</p>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </div>

              <button
                onClick={handleComplete}
                disabled={isSubmitting}
                className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white py-3 rounded-lg font-medium transition min-h-[44px]"
              >
                {isSubmitting ? 'Wird gespeichert...' : '✓ Als erledigt markieren'}
              </button>
            </div>
          )}

          {/* Not authenticated message */}
          {!isAuthenticated && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
              <p className="text-amber-700">
                Melde dich an, um diese Aufgabe als erledigt zu markieren und Guthaben zu verdienen!
              </p>
            </div>
          )}
        </div>

        {/* Sticky Bottom Action Bar (Mobile) */}
        {isAuthenticated && task.status !== 'done' && (
          <div className="sticky bottom-0 bg-white border-t border-gray-200 p-3 sm:hidden" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
            <button
              onClick={handleComplete}
              disabled={isSubmitting}
              className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white py-3 rounded-lg font-medium transition min-h-[44px]"
            >
              {isSubmitting ? 'Wird gespeichert...' : '✓ Erledigt'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
