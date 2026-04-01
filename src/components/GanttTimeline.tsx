import { useEffect, useRef, useState } from 'react';

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
  start_date?: string;
  due_date?: string;
  dependencies?: number[];
  assigned_to_list?: Assignee[];
  children_count?: number;
  comment_count?: number;
  has_blockers?: boolean;
}

interface Props {
  tasks: Task[];
  onTaskUpdate: (taskId: number, updates: Record<string, any>) => void;
  onTaskClick: (task: Task) => void;
}

const PRIORITY_BAR_COLORS: Record<string, string> = {
  kritisch: '#ef4444',
  hoch: '#f59e0b',
  mittel: '#3b82f6',
  niedrig: '#22c55e',
};

type ViewMode = 'Week' | 'Half Month' | 'Month';

export default function GanttTimeline({ tasks, onTaskUpdate, onTaskClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<any>(null);
  const [zoom, setZoom] = useState<ViewMode>('Month');
  const [ganttLoaded, setGanttLoaded] = useState(false);

  // Filter to only projects with start_date AND due_date
  const ganttTasks = tasks.filter(
    t => t.task_type === 'project' && t.start_date && t.due_date
  );

  useEffect(() => {
    if (!containerRef.current || ganttTasks.length === 0) return;

    let cancelled = false;

    const initGantt = async () => {
      try {
        const FrappeGantt = (await import('frappe-gantt')).default;
        if (cancelled || !containerRef.current) return;

        // Clear previous
        containerRef.current.innerHTML = '';

        const frappeTaskList = ganttTasks.map(task => {
          const deps = (task.dependencies || [])
            .filter(depId => ganttTasks.some(t => t.id === depId))
            .map(depId => `task-${depId}`);

          // Calculate progress from children completion
          let progress = 0;
          if (task.status === 'done') progress = 100;
          else if (task.status === 'in_progress') progress = 50;
          else if (task.status === 'next') progress = 25;

          return {
            id: `task-${task.id}`,
            name: task.title,
            start: task.start_date!,
            end: task.due_date!,
            progress,
            dependencies: deps.join(', '),
            custom_class: `priority-${task.priority || 'mittel'}`,
          };
        });

        const gantt = new FrappeGantt(containerRef.current, frappeTaskList, {
          view_mode: zoom,
          date_format: 'YYYY-MM-DD',
          language: 'de',
          on_click: (frappeTask: any) => {
            const taskId = parseInt(frappeTask.id.replace('task-', ''));
            const task = ganttTasks.find(t => t.id === taskId);
            if (task) onTaskClick(task);
          },
          on_date_change: (frappeTask: any, start: Date, end: Date) => {
            const taskId = parseInt(frappeTask.id.replace('task-', ''));
            const startStr = start.toISOString().split('T')[0];
            const endStr = end.toISOString().split('T')[0];
            onTaskUpdate(taskId, { start_date: startStr, due_date: endStr });
          },
          on_progress_change: (_task: any, _progress: number) => {
            // Not used, progress is computed
          },
          custom_popup_html: (frappeTask: any) => {
            const taskId = parseInt(frappeTask.id.replace('task-', ''));
            const task = ganttTasks.find(t => t.id === taskId);
            if (!task) return '';
            return `
              <div class="gantt-popup-title">${task.title}</div>
              <div class="gantt-popup-subtitle">
                ${task.start_date} - ${task.due_date}
                ${task.priority ? ` | ${task.priority}` : ''}
              </div>
            `;
          },
        });

        ganttRef.current = gantt;
        setGanttLoaded(true);
      } catch (err) {
        console.error('Failed to load Gantt chart:', err);
      }
    };

    initGantt();

    return () => {
      cancelled = true;
    };
  }, [ganttTasks.length, zoom]);

  // Update zoom without full re-render
  useEffect(() => {
    if (ganttRef.current && ganttLoaded) {
      try {
        ganttRef.current.change_view_mode(zoom);
      } catch {
        // Fallback: full re-init handled by dependency on zoom above
      }
    }
  }, [zoom, ganttLoaded]);

  if (ganttTasks.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-8 text-center">
        <div className="text-4xl mb-4">📊</div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Keine Timeline-Daten</h3>
        <p className="text-gray-600">
          Setze Start- und Enddatum bei Projekten, um sie in der Timeline zu sehen.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="font-medium text-gray-700">Timeline</h3>
        <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-0.5">
          {(['Week', 'Half Month', 'Month'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setZoom(mode)}
              className={`px-3 py-1 text-xs rounded font-medium transition ${
                zoom === mode
                  ? 'bg-garden-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {mode === 'Week' ? 'Woche' : mode === 'Half Month' ? '2 Wochen' : 'Monat'}
            </button>
          ))}
        </div>
      </div>

      {/* Gantt Container */}
      <div className="overflow-x-auto gantt-container">
        <div ref={containerRef} />
      </div>

      {/* Priority Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
        {Object.entries(PRIORITY_BAR_COLORS).map(([priority, color]) => (
          <div key={priority} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
            <span className="capitalize">{priority}</span>
          </div>
        ))}
      </div>

      {/* Gantt Custom Styles */}
      <style>{`
        .gantt-container .gantt .bar-wrapper .bar {
          rx: 4;
          ry: 4;
        }
        .gantt-container .gantt .bar-wrapper.priority-kritisch .bar {
          fill: ${PRIORITY_BAR_COLORS.kritisch};
        }
        .gantt-container .gantt .bar-wrapper.priority-hoch .bar {
          fill: ${PRIORITY_BAR_COLORS.hoch};
        }
        .gantt-container .gantt .bar-wrapper.priority-mittel .bar {
          fill: ${PRIORITY_BAR_COLORS.mittel};
        }
        .gantt-container .gantt .bar-wrapper.priority-niedrig .bar {
          fill: ${PRIORITY_BAR_COLORS.niedrig};
        }
        .gantt-container .gantt .bar-wrapper .bar-progress {
          opacity: 0.5;
        }
        .gantt-container .gantt .today-highlight {
          fill: rgba(34, 197, 94, 0.1);
        }
        .gantt-popup-title {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 4px;
        }
        .gantt-popup-subtitle {
          font-size: 12px;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}
