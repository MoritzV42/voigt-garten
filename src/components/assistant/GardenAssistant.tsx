import { useState, useCallback, useRef, useEffect, useMemo } from "react";

// ─── Types ──────────────────────────────────────────────────

type UserRole = "anonymous" | "guest" | "admin";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type DraftState = {
  type: "mangel" | "bug" | "feature" | "feedback";
  title: string;
  message: string;
};

type ChatResult = {
  intent: string;
  answer: string;
  draft?: DraftState;
};

const API_URL = import.meta.env.PUBLIC_API_URL || "https://garten.infinityspace42.de";

const REPORT_TYPE_LABELS: Record<string, string> = {
  mangel: "Mangel / Defekt",
  bug: "Bug",
  feature: "Feature-Wunsch",
  feedback: "Feedback",
};

const ROLE_LABELS: Record<UserRole, string> = {
  anonymous: "Besucher",
  guest: "Gast",
  admin: "Admin-Modus",
};

const ROLE_COLORS: Record<UserRole, string> = {
  anonymous: "text-gray-500",
  guest: "text-garden-600",
  admin: "text-amber-600",
};

// ─── Component ──────────────────────────────────────────────

export default function GardenAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSent, setLoginSent] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Determine user role from token
  const userRole: UserRole = useMemo(() => {
    try {
      const token = localStorage.getItem("voigt-garten-token");
      if (!token) return "anonymous";
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.role === "admin") return "admin";
      return "guest";
    } catch {
      return "anonymous";
    }
  }, []);

  // Quick-action suggestions based on role
  const suggestions = useMemo(() => {
    const base = ["Was gibt es hier?", "Wie buche ich?"];
    if (userRole === "admin") {
      return [...base, "Überfällige Aufgaben?", "Galerie-Status?"];
    }
    if (userRole === "guest") {
      return [...base, "Etwas ist kaputt", "Ich habe eine Idee"];
    }
    return [...base, "Etwas ist kaputt", "Ich habe eine Idee"];
  }, [userRole]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, draft]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen]);

  // Load history from localStorage
  useEffect(() => {
    if (!isOpen) return;
    const saved = localStorage.getItem("garten-assistant-messages");
    if (saved) {
      try {
        setMessages(JSON.parse(saved));
      } catch {}
    }
  }, [isOpen]);

  // Save messages to localStorage
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(
        "garten-assistant-messages",
        JSON.stringify(messages.slice(-50))
      );
    }
  }, [messages]);

  const handleClose = useCallback(() => setIsOpen(false), []);

  // ─── Send Message ─────────────────────────────────────────

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const userMsg = text.trim();
      setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
      setInput("");
      setLoading(true);
      setError(null);

      try {
        const token = localStorage.getItem("voigt-garten-token");
        const body: Record<string, unknown> = { message: userMsg };

        if (draft) {
          body.mode = "refine";
          body.draft = draft;
        }

        const res = await fetch(`${API_URL}/api/assistant/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? `Fehler (${res.status})`);
        }

        const result: ChatResult = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.answer },
        ]);

        if (result.draft) setDraft(result.draft);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unbekannter Fehler.");
      } finally {
        setLoading(false);
      }
    },
    [draft]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      sendMessage(input);
    },
    [input, sendMessage]
  );

  // ─── Draft Submit (uses existing /api/issues) ─────────────

  const submitDraft = useCallback(async () => {
    if (!draft) return;
    setSubmitting(true);
    setError(null);

    try {
      const token = localStorage.getItem("voigt-garten-token");
      const res = await fetch(`${API_URL}/api/issues`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: draft.title,
          description: draft.message,
          report_type: draft.type,
          category: "allgemein",
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Fehler (${res.status})`);
      }

      const label = REPORT_TYPE_LABELS[draft.type] || draft.type;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `${label} "${draft.title}" wurde erfolgreich eingereicht!`,
        },
      ]);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Einreichen fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }, [draft]);

  const discardDraft = useCallback(() => {
    setDraft(null);
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: "Entwurf verworfen." },
    ]);
  }, []);

  // ─── Draft field updaters (stable refs) ───────────────────

  const updateDraftTitle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev));
    },
    []
  );

  const updateDraftMessage = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setDraft((prev) => (prev ? { ...prev, message: e.target.value } : prev));
    },
    []
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    setDraft(null);
    localStorage.removeItem("garten-assistant-messages");
  }, []);

  return (
    <>
      {/* Floating Button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-garden-700 text-white shadow-lg transition hover:bg-garden-800 active:scale-95 sm:bottom-6 sm:right-6"
        title="Garten-Assistent"
        style={{ boxShadow: "0 4px 20px rgba(22, 101, 52, 0.3)" }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 10h.01" />
          <path d="M12 10h.01" />
          <path d="M16 10h.01" />
        </svg>
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-end sm:justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
            onClick={handleClose}
          />

          {/* Panel */}
          <div className="relative z-10 flex h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:m-4 sm:mb-4 sm:mr-4 sm:h-[600px] sm:rounded-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-garden-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-garden-600 text-white">
                  <span className="text-lg">🌳</span>
                </div>
                <div>
                  <h2 className="font-display text-base font-semibold text-gray-900">
                    Garten-Assistent
                  </h2>
                  <p className={`text-xs ${ROLE_COLORS[userRole]}`}>
                    {ROLE_LABELS[userRole]}
                    {userRole === "anonymous" && (
                      <span className="text-gray-400"> · Einloggen für mehr</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={clearHistory}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                  title="Chat leeren"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100"
                >
                  <span className="text-xl leading-none">&times;</span>
                </button>
              </div>
            </div>

            {/* Login-Gate (F.5) — Chat ist eingeloggten Nutzern vorbehalten */}
            {userRole === "anonymous" ? (
              <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-garden-50">
                  <span className="text-3xl">🔐</span>
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">
                  Chat nur für eingeloggte Nutzer
                </h3>
                <p className="text-sm text-gray-600 mb-5 max-w-[280px]">
                  Damit Moritz dich bei Bedarf erreichen kann, brauchst du einen
                  Magic-Link zum Einloggen.
                </p>
                {loginSent ? (
                  <div className="rounded-xl border border-garden-200 bg-garden-50 px-4 py-3 text-sm text-garden-800 max-w-[280px]">
                    Wir haben dir einen Login-Link an{" "}
                    <strong>{loginEmail}</strong> gesendet. Bitte schaue in deine
                    Inbox (auch Spam) und klicke den Link.
                  </div>
                ) : (
                  <form
                    className="w-full max-w-[280px] flex flex-col gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!loginEmail.trim()) return;
                      setLoginLoading(true);
                      setError(null);
                      try {
                        const res = await fetch(
                          `${API_URL}/api/auth/request-magic-link`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ email: loginEmail.trim() }),
                          }
                        );
                        if (!res.ok) {
                          const json = await res.json().catch(() => ({}));
                          throw new Error(
                            json.error ?? `Fehler (${res.status})`
                          );
                        }
                        setLoginSent(true);
                      } catch (err) {
                        setError(
                          err instanceof Error
                            ? err.message
                            : "Magic-Link konnte nicht gesendet werden."
                        );
                      } finally {
                        setLoginLoading(false);
                      }
                    }}
                  >
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="deine@email.de"
                      disabled={loginLoading}
                      className="rounded-xl border border-garden-200 bg-white px-4 py-2.5 text-sm text-gray-800 focus:border-garden-500 focus:outline-none focus:ring-2 focus:ring-garden-500/40 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={loginLoading || !loginEmail.trim()}
                      className="rounded-xl bg-garden-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-garden-700 disabled:opacity-50"
                    >
                      {loginLoading ? "Sende ..." : "Magic-Link senden"}
                    </button>
                    {error && (
                      <p className="text-xs text-red-600 mt-1">{error}</p>
                    )}
                  </form>
                )}
              </div>
            ) : (
            <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && !draft && (
                <div className="flex flex-col items-center justify-center h-full text-center px-4">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-garden-50">
                    <span className="text-3xl">🌿</span>
                  </div>
                  <p className="text-sm font-medium text-gray-800">
                    Hallo! Wie kann ich dir helfen?
                  </p>
                  <p className="mt-1 text-xs text-gray-500 max-w-[260px]">
                    Stelle eine Frage zum Garten, melde einen Mangel oder gib Feedback.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => sendMessage(suggestion)}
                        className="rounded-full border border-garden-200 bg-garden-50 px-3 py-1.5 text-xs text-gray-700 transition hover:border-garden-400 hover:bg-garden-100"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      msg.role === "user"
                        ? "bg-garden-700 text-white"
                        : "bg-gray-100 text-gray-800 border border-gray-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}

              {/* Draft Card */}
              {draft && (
                <div className="mx-1 rounded-xl border-l-4 border-garden-500 bg-garden-50 p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-garden-100 px-2.5 py-0.5 text-xs font-medium text-garden-800">
                      {REPORT_TYPE_LABELS[draft.type] || draft.type} - Entwurf
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-0.5">
                        Titel
                      </label>
                      <input
                        type="text"
                        value={draft.title}
                        onChange={updateDraftTitle}
                        maxLength={200}
                        className="w-full rounded-lg border border-garden-200 bg-white px-3 py-1.5 text-sm text-gray-800 focus:border-garden-500 focus:outline-none focus:ring-1 focus:ring-garden-500/40"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-0.5">
                        Beschreibung
                      </label>
                      <textarea
                        value={draft.message}
                        onChange={updateDraftMessage}
                        rows={3}
                        maxLength={5000}
                        className="w-full rounded-lg border border-garden-200 bg-white px-3 py-1.5 text-sm text-gray-800 focus:border-garden-500 focus:outline-none focus:ring-1 focus:ring-garden-500/40 resize-none"
                      />
                    </div>
                  </div>

                  <p className="mt-2 text-[10px] text-gray-500">
                    Tipp: Schreib im Chat z.B. &quot;Ändere den Titel zu...&quot; um den Entwurf per KI anzupassen.
                  </p>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={submitDraft}
                      disabled={submitting || !draft.title.trim() || !draft.message.trim()}
                      className="rounded-lg bg-garden-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-garden-700 disabled:opacity-50"
                    >
                      {submitting ? "Wird eingereicht..." : "Einreichen"}
                    </button>
                    <button
                      type="button"
                      onClick={discardDraft}
                      disabled={submitting}
                      className="rounded-lg border border-garden-200 bg-white px-4 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                    >
                      Verwerfen
                    </button>
                  </div>
                </div>
              )}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-500">
                    <span className="inline-flex gap-1">
                      <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                      <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Error */}
            {error && (
              <div className="mx-4 mb-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            {/* Input Area */}
            <div className="border-t border-garden-100 px-4 py-3">
              <form onSubmit={handleSubmit} className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    draft
                      ? "Entwurf ändern, z.B. 'Ändere den Titel zu...'"
                      : "Nachricht eingeben..."
                  }
                  disabled={loading}
                  maxLength={2000}
                  className="flex-1 rounded-xl border border-garden-200 bg-garden-50 px-4 py-2.5 text-sm text-gray-800 focus:border-garden-500 focus:outline-none focus:ring-2 focus:ring-garden-500/40 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-garden-600 text-white transition hover:bg-garden-700 disabled:opacity-50"
                  title="Absenden"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m5 12 7-7 7 7" />
                    <path d="M12 19V5" />
                  </svg>
                </button>
              </form>
            </div>
            </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
