import { useEffect, useRef, useState } from 'react';

type ReportDetail = {
  type?: string;
  title?: string;
  description?: string;
  priority?: string;
  screenshot?: File | null;
  screenshotPreview?: string | null;
  screenshotName?: string;
  autoReported?: boolean;
};

type Phase = 'idle' | 'submitting' | 'success' | 'error';

const WHATSAPP_NUMBER = '4915221380878';

function buildWhatsappHref(title: string, description: string): string {
  const text = `Fehler im Garten-Portal:\n\n${title}\n\n${description.slice(0, 800)}`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
}

export default function BugReportModal() {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const honeypotRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onOpenFeedback(e: Event) {
      const d = ((e as CustomEvent).detail ?? {}) as ReportDetail;
      window.dispatchEvent(new CustomEvent('open-feedback-accepted'));
      const rawTitle = (d.title ?? 'Unbekannter Fehler').replace(/^\[AUTO\]\s*/, '').trim();
      setDetail(d);
      setTitle(rawTitle.slice(0, 120));
      setDescription(d.description ?? '');
      setScreenshotPreview(d.screenshotPreview ?? null);
      setPhase('idle');
      setErrorMessage('');
    }
    window.addEventListener('open-feedback', onOpenFeedback);
    return () => window.removeEventListener('open-feedback', onOpenFeedback);
  }, []);

  function close() {
    setDetail(null);
    setPhase('idle');
    setErrorMessage('');
  }

  async function submit() {
    if (!detail) return;
    if (honeypotRef.current?.value) return;
    if (description.trim().length < 10) {
      setErrorMessage('Bitte ergänze eine kurze Beschreibung (mind. 10 Zeichen).');
      setPhase('error');
      return;
    }

    setPhase('submitting');
    setErrorMessage('');

    const form = new FormData();
    form.append('title', title);
    form.append('description', description);
    form.append('page_url', window.location.href);
    form.append('user_agent', navigator.userAgent);
    form.append('website', '');
    if (detail.screenshot) {
      form.append('screenshot', detail.screenshot, detail.screenshotName || 'screenshot.png');
    }

    try {
      const res = await fetch('/api/bugreport', { method: 'POST', body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setPhase('success');
      setTimeout(close, 1500);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Senden fehlgeschlagen';
      setErrorMessage(msg);
      setPhase('error');
    }
  }

  if (!detail) return null;

  const waHref = buildWhatsappHref(title, description);
  const showWhatsappProminent = phase === 'error';

  return (
    <div
      data-feedback-modal
      className="no-screenshot fixed inset-0 z-[70] flex items-end justify-center sm:items-center"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={phase === 'submitting' ? undefined : close}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:m-4 sm:rounded-2xl">
        <div className="flex items-start justify-between border-b border-garden-100 bg-garden-50 px-6 py-4">
          <div>
            <h2 className="font-display text-lg text-garden-900">Fehler melden</h2>
            <p className="mt-1 text-xs text-gray-600">
              Die Meldung geht direkt ans Entwicklungs-Team und wird automatisch bearbeitet.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={phase === 'submitting'}
            aria-label="Schließen"
            className="rounded-full p-1 text-gray-500 transition hover:bg-white hover:text-gray-800 disabled:opacity-50"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-gray-600">Titel</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 120))}
              disabled={phase === 'submitting'}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-garden-600 focus:outline-none focus:ring-1 focus:ring-garden-600"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
              Beschreibung / Fehlercode
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={phase === 'submitting'}
              rows={8}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs leading-relaxed focus:border-garden-600 focus:outline-none focus:ring-1 focus:ring-garden-600"
            />
          </label>

          {screenshotPreview && (
            <div>
              <span className="block text-xs font-semibold uppercase tracking-wide text-gray-600">Screenshot</span>
              <div className="mt-1 relative rounded-lg border border-gray-200 bg-gray-50 p-2">
                <img
                  src={screenshotPreview}
                  alt="Screenshot"
                  className="max-h-48 w-full rounded object-contain"
                />
                <button
                  type="button"
                  onClick={() => {
                    setScreenshotPreview(null);
                    setDetail((prev) => (prev ? { ...prev, screenshot: null, screenshotPreview: null } : prev));
                  }}
                  disabled={phase === 'submitting'}
                  aria-label="Screenshot entfernen"
                  className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow transition hover:bg-white disabled:opacity-50"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3l8 8M11 3L3 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Honeypot — für Menschen unsichtbar, für Bots sichtbar */}
          <input
            ref={honeypotRef}
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />

          {phase === 'error' && errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {errorMessage}
            </div>
          )}
          {phase === 'success' && (
            <div className="rounded-lg border border-garden-200 bg-garden-50 px-3 py-2 text-sm text-garden-800">
              Danke! Deine Meldung ist eingegangen.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4 sm:flex-row">
          <button
            type="button"
            onClick={submit}
            disabled={phase === 'submitting' || phase === 'success'}
            className="flex-1 rounded-lg bg-garden-700 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-garden-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {phase === 'submitting' ? 'Wird gesendet …' : 'Senden'}
          </button>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className={
              showWhatsappProminent
                ? 'flex-1 rounded-lg bg-[#25D366] px-4 py-2.5 text-center text-sm font-semibold text-white shadow transition hover:bg-[#1fb855]'
                : 'flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-gray-700 transition hover:bg-gray-100'
            }
          >
            {showWhatsappProminent ? 'Per WhatsApp melden' : 'WhatsApp-Fallback'}
          </a>
        </div>
      </div>
    </div>
  );
}
