import { useState, useRef } from 'react';

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

interface Props {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (taskId: number, taskType: string, notes?: string, photo?: File) => void;
  onStatusChange: (taskId: number, status: string) => void;
  isAuthenticated: boolean;
  isAdmin: boolean;
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

export default function TaskDetailModal({
  task,
  isOpen,
  onClose,
  onComplete,
  onStatusChange,
  isAuthenticated,
  isAdmin
}: Props) {
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const category = CATEGORY_CONFIG[task.category] || CATEGORY_CONFIG.sonstiges;
  const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      setPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    await onComplete(task.id, task.task_type, notes, photo || undefined);
    setIsSubmitting(false);
    setNotes('');
    setPhoto(null);
    setPhotoPreview(null);
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center gap-1 text-sm px-3 py-1 rounded-full ${category.color}`}>
                {category.emoji} {category.label}
              </span>
              {task.task_type === 'recurring' && (
                <span className="text-sm bg-purple-100 text-purple-700 px-3 py-1 rounded-full">
                  🔄 Alle {task.cycle_days} Tage
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-gray-900">{task.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Description */}
          {task.description && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">Beschreibung</h3>
              <p className="text-gray-700">{task.description}</p>
            </div>
          )}

          {/* Details Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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

            {task.assigned_to && (
              <div className="bg-gray-50 rounded-lg p-3">
                <div className="text-sm text-gray-500">Zugewiesen an</div>
                <div className="text-lg font-medium text-gray-700">👤 {task.assigned_to}</div>
              </div>
            )}
          </div>

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
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
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

              {/* Notes */}
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

              {/* Photo Upload */}
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
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center"
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

              {/* Submit Button */}
              <button
                onClick={handleComplete}
                disabled={isSubmitting}
                className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white py-3 rounded-lg font-medium transition"
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
      </div>
    </div>
  );
}
