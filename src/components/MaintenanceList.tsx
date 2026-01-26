import { useState, useEffect } from 'react';
import { format, differenceInDays, addDays } from 'date-fns';
import { de } from 'date-fns/locale';

interface Task {
  id: number;
  title: string;
  cycleDays: number;
  creditValue: number;
  description: string;
  lastDone?: string;
  nextDue?: string;
}

interface Category {
  id: string;
  name: string;
  emoji: string;
  tasks: Task[];
}

interface Props {
  categories: Category[];
}

type StatusFilter = 'all' | 'overdue' | 'due-soon' | 'ok';

export default function MaintenanceList({ categories }: Props) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [taskStates, setTaskStates] = useState<Record<number, { lastDone: string | null }>>({});
  const [completingTask, setCompletingTask] = useState<number | null>(null);

  // Load task states from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('voigt-garten-tasks');
    if (saved) {
      setTaskStates(JSON.parse(saved));
    }
  }, []);

  // Save task states to localStorage
  useEffect(() => {
    if (Object.keys(taskStates).length > 0) {
      localStorage.setItem('voigt-garten-tasks', JSON.stringify(taskStates));
    }
  }, [taskStates]);

  const getTaskStatus = (task: Task): 'overdue' | 'due-soon' | 'ok' => {
    const lastDone = taskStates[task.id]?.lastDone;
    if (!lastDone) return 'overdue'; // Never done = overdue

    const nextDue = addDays(new Date(lastDone), task.cycleDays);
    const daysUntilDue = differenceInDays(nextDue, new Date());

    if (daysUntilDue < 0) return 'overdue';
    if (daysUntilDue <= 7) return 'due-soon';
    return 'ok';
  };

  const getStatusColor = (status: 'overdue' | 'due-soon' | 'ok') => {
    switch (status) {
      case 'overdue': return 'bg-red-100 text-red-800 border-red-200';
      case 'due-soon': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'ok': return 'bg-green-100 text-green-800 border-green-200';
    }
  };

  const getStatusLabel = (status: 'overdue' | 'due-soon' | 'ok') => {
    switch (status) {
      case 'overdue': return 'Überfällig';
      case 'due-soon': return 'Bald fällig';
      case 'ok': return 'OK';
    }
  };

  const markAsDone = async (taskId: number) => {
    setCompletingTask(taskId);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));

    setTaskStates(prev => ({
      ...prev,
      [taskId]: { lastDone: new Date().toISOString() }
    }));

    setCompletingTask(null);

    // PLACEHOLDER: API call to record completion and credit
    // await fetch('/api/maintenance/complete', {
    //   method: 'POST',
    //   body: JSON.stringify({ taskId, completedAt: new Date().toISOString() })
    // });
  };

  const filterTasks = (tasks: Task[]) => {
    if (filter === 'all') return tasks;
    return tasks.filter(task => getTaskStatus(task) === filter);
  };

  // Update stats in DOM
  useEffect(() => {
    const allTasks = categories.flatMap(c => c.tasks);
    const overdue = allTasks.filter(t => getTaskStatus(t) === 'overdue').length;
    const dueSoon = allTasks.filter(t => getTaskStatus(t) === 'due-soon').length;
    const ok = allTasks.filter(t => getTaskStatus(t) === 'ok').length;

    document.getElementById('stat-overdue')!.textContent = String(overdue);
    document.getElementById('stat-due-soon')!.textContent = String(dueSoon);
    document.getElementById('stat-ok')!.textContent = String(ok);
  }, [taskStates, categories]);

  return (
    <div className="space-y-6">
      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {[
          { value: 'all', label: 'Alle', color: 'bg-gray-100 text-gray-800' },
          { value: 'overdue', label: 'Überfällig', color: 'bg-red-100 text-red-800' },
          { value: 'due-soon', label: 'Bald fällig', color: 'bg-amber-100 text-amber-800' },
          { value: 'ok', label: 'OK', color: 'bg-green-100 text-green-800' },
        ].map(({ value, label, color }) => (
          <button
            key={value}
            onClick={() => setFilter(value as StatusFilter)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === value ? color + ' ring-2 ring-offset-1' : 'bg-white hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Categories */}
      {categories.map(category => {
        const filteredTasks = filterTasks(category.tasks);
        if (filteredTasks.length === 0 && filter !== 'all') return null;

        const isExpanded = expandedCategory === category.id || filter !== 'all';

        return (
          <div key={category.id} className="bg-white rounded-xl shadow-lg overflow-hidden">
            {/* Category Header */}
            <button
              onClick={() => setExpandedCategory(expandedCategory === category.id ? null : category.id)}
              className="w-full flex items-center justify-between p-4 bg-garden-50 hover:bg-garden-100 transition"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{category.emoji}</span>
                <h3 className="font-semibold text-garden-800">{category.name}</h3>
                <span className="text-sm text-garden-600">
                  ({filteredTasks.length} {filter === 'all' ? 'Aufgaben' : getStatusLabel(filter as any)})
                </span>
              </div>
              <span className="text-garden-600">
                {isExpanded ? '▼' : '▶'}
              </span>
            </button>

            {/* Tasks */}
            {isExpanded && (
              <div className="divide-y divide-gray-100">
                {filteredTasks.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    Keine Aufgaben in dieser Kategorie
                  </div>
                ) : (
                  filteredTasks.map(task => {
                    const status = getTaskStatus(task);
                    const lastDone = taskStates[task.id]?.lastDone;
                    const nextDue = lastDone ? addDays(new Date(lastDone), task.cycleDays) : null;

                    return (
                      <div key={task.id} className="p-4 hover:bg-gray-50 transition">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium text-gray-900">{task.title}</h4>
                              <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(status)}`}>
                                {getStatusLabel(status)}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                              <span>🔄 Alle {task.cycleDays} Tage</span>
                              {task.creditValue > 0 && (
                                <span className="text-garden-600 font-medium">💰 {task.creditValue}€ Guthaben</span>
                              )}
                              {lastDone && (
                                <span>
                                  Zuletzt: {format(new Date(lastDone), 'dd.MM.yyyy', { locale: de })}
                                </span>
                              )}
                              {nextDue && (
                                <span>
                                  Fällig: {format(nextDue, 'dd.MM.yyyy', { locale: de })}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => markAsDone(task.id)}
                            disabled={completingTask === task.id}
                            className="bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap"
                          >
                            {completingTask === task.id ? '...' : '✓ Erledigt'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
