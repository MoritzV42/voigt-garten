import { useState, useEffect } from 'react';

interface EmailDraft {
  id: string;
  to: string;
  toName: string;
  subject: string;
  body: string;
  task: string;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export default function EmailDraftModal() {
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<EmailDraft | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editedBody, setEditedBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Load pending drafts
  useEffect(() => {
    // PLACEHOLDER: Fetch from API
    // const response = await fetch('/api/email-drafts?status=pending');
    // setDrafts(await response.json());

    // Demo data - normally empty
    const demoDrafts: EmailDraft[] = [];
    setDrafts(demoDrafts);

    // Update pending count in sidebar
    const pendingEl = document.getElementById('pending-emails');
    if (pendingEl) {
      if (demoDrafts.length === 0) {
        pendingEl.innerHTML = '<p class="text-gray-500 italic">Keine ausstehenden Anfragen</p>';
      } else {
        pendingEl.innerHTML = demoDrafts.map(d =>
          `<div class="bg-white rounded p-2 mb-2 cursor-pointer hover:bg-amber-100" data-draft-id="${d.id}">
            <div class="font-medium">${d.toName}</div>
            <div class="text-xs">${d.task}</div>
          </div>`
        ).join('');
      }
    }
  }, []);

  const openDraft = (draft: EmailDraft) => {
    setSelectedDraft(draft);
    setEditedBody(draft.body);
    setIsOpen(true);
  };

  const closeDraft = () => {
    setSelectedDraft(null);
    setIsOpen(false);
    setEditedBody('');
  };

  const approveDraft = async () => {
    if (!selectedDraft) return;

    setIsSending(true);

    try {
      // PLACEHOLDER: API call to send email
      // await fetch(`/api/email-drafts/${selectedDraft.id}/approve`, {
      //   method: 'POST',
      //   body: JSON.stringify({ body: editedBody })
      // });

      await new Promise(resolve => setTimeout(resolve, 1000));

      // Remove from list
      setDrafts(prev => prev.filter(d => d.id !== selectedDraft.id));

      alert('✅ Email wurde erfolgreich versendet!');
      closeDraft();
    } catch (error) {
      alert('❌ Fehler beim Versenden. Bitte versuche es erneut.');
    } finally {
      setIsSending(false);
    }
  };

  const rejectDraft = async () => {
    if (!selectedDraft) return;

    // PLACEHOLDER: API call to reject
    // await fetch(`/api/email-drafts/${selectedDraft.id}/reject`, { method: 'POST' });

    setDrafts(prev => prev.filter(d => d.id !== selectedDraft.id));
    closeDraft();
  };

  if (!isOpen || !selectedDraft) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="bg-purple-600 text-white p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🤖</span>
              <div>
                <h2 className="font-semibold">Email-Entwurf prüfen</h2>
                <p className="text-sm text-purple-200">Claude hat diese Email erstellt</p>
              </div>
            </div>
            <button onClick={closeDraft} className="text-white/80 hover:text-white text-2xl">
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Task Info */}
          <div className="bg-amber-50 rounded-lg p-3 text-sm">
            <strong>Anlass:</strong> {selectedDraft.task}
          </div>

          {/* Email Details */}
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">An:</label>
              <div className="bg-gray-100 rounded-lg px-4 py-2">
                {selectedDraft.toName} &lt;{selectedDraft.to}&gt;
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Betreff:</label>
              <div className="bg-gray-100 rounded-lg px-4 py-2">
                {selectedDraft.subject}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Nachricht: <span className="text-gray-400 font-normal">(kann bearbeitet werden)</span>
              </label>
              <textarea
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={10}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent font-mono text-sm"
              />
            </div>
          </div>

          {/* Warning */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            ⚠️ <strong>Wichtig:</strong> Diese Email wird an eine echte Person gesendet!
            Bitte prüfe den Inhalt sorgfältig.
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-gray-200 p-4 flex justify-end gap-3 bg-gray-50">
          <button
            onClick={rejectDraft}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 transition font-medium"
          >
            ❌ Ablehnen
          </button>
          <button
            onClick={approveDraft}
            disabled={isSending}
            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-medium disabled:bg-gray-400"
          >
            {isSending ? '⏳ Wird gesendet...' : '✅ Genehmigen & Senden'}
          </button>
        </div>
      </div>
    </div>
  );
}
