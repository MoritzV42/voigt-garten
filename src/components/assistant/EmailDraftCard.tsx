import { useState, useCallback } from "react";

const API_URL = import.meta.env.PUBLIC_API_URL || "https://garten.infinityspace42.de";

type EmailDraft = {
  id: number;
  recipient_name: string;
  recipient_email: string;
  subject: string;
  body_html: string;
  status: string;
  created_at: string;
};

type Props = {
  draft: EmailDraft;
  onAction?: (action: "approved" | "rejected", draftId: number) => void;
};

export default function EmailDraftCard({ draft, onAction }: Props) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(draft.status);

  const handleAction = useCallback(
    async (action: "approve" | "reject") => {
      setLoading(true);
      try {
        const token = localStorage.getItem("voigt-garten-token");
        const res = await fetch(
          `${API_URL}/api/admin/email-drafts/${draft.id}/${action}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          }
        );

        if (!res.ok) throw new Error("Fehler");

        const newStatus = action === "approve" ? "sent" : "rejected";
        setStatus(newStatus);
        onAction?.(action === "approve" ? "approved" : "rejected", draft.id);
      } catch {
        // Fehler still ignorieren
      } finally {
        setLoading(false);
      }
    },
    [draft.id, onAction]
  );

  const statusColors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    sent: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
  };

  return (
    <div className="mx-1 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
          Email-Entwurf
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColors[status] || "bg-gray-100 text-gray-600"}`}>
          {status === "pending" ? "Warte auf Freigabe" : status === "sent" ? "Gesendet" : "Abgelehnt"}
        </span>
      </div>

      <div className="space-y-1 text-sm">
        <p className="text-gray-600">
          <span className="font-medium text-gray-700">An:</span> {draft.recipient_name} ({draft.recipient_email})
        </p>
        <p className="text-gray-600">
          <span className="font-medium text-gray-700">Betreff:</span> {draft.subject}
        </p>
      </div>

      {status === "pending" && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleAction("approve")}
            disabled={loading}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
          >
            Genehmigen & Senden
          </button>
          <button
            type="button"
            onClick={() => handleAction("reject")}
            disabled={loading}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            Ablehnen
          </button>
        </div>
      )}
    </div>
  );
}
