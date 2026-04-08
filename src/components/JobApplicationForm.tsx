import { useEffect, useState, useRef } from 'react';

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';

type Position = '' | 'tech_student' | 'elektro_meister' | 'gaertner' | 'initiativ';

const POSITION_OPTIONS: { value: Exclude<Position, ''>; label: string }[] = [
  { value: 'tech_student', label: 'Tech-Aushilfe / Student' },
  { value: 'elektro_meister', label: 'Elektro-Meister / E-Check' },
  { value: 'gaertner', label: 'Gärtner / Instandhaltung' },
  { value: 'initiativ', label: 'Initiativbewerbung' },
];

const HOURS_OPTIONS = [5, 10, 20, 40];
const MAX_RESUME_MB = 5;

interface FormState {
  name: string;
  email: string;
  phone: string;
  position: Position;
  available_from: string;
  hours_per_week: string;
  preferred_times: string;
  motivation: string;
}

const INITIAL_STATE: FormState = {
  name: '',
  email: '',
  phone: '',
  position: '',
  available_from: '',
  hours_per_week: '',
  preferred_times: '',
  motivation: '',
};

export default function JobApplicationForm() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [resume, setResume] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Preselect position via sessionStorage or CustomEvent from jobs.astro cards
  useEffect(() => {
    try {
      const pre = sessionStorage.getItem('preselectPosition');
      if (pre && POSITION_OPTIONS.some(o => o.value === pre)) {
        setForm(f => ({ ...f, position: pre as Position }));
        sessionStorage.removeItem('preselectPosition');
      }
    } catch {}

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail && POSITION_OPTIONS.some(o => o.value === detail)) {
        setForm(f => ({ ...f, position: detail as Position }));
      }
    };
    window.addEventListener('preselect-position', handler);
    return () => window.removeEventListener('preselect-position', handler);
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(f => ({ ...f, [key]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setResumeError(null);
    const file = e.target.files?.[0] || null;
    if (!file) {
      setResume(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setResumeError('Nur PDF-Dateien erlaubt.');
      setResume(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_RESUME_MB * 1024 * 1024) {
      setResumeError(`Datei zu groß (max ${MAX_RESUME_MB} MB).`);
      setResume(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setResume(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validation
    if (!form.name.trim() || !form.email.trim() || !form.position || !form.motivation.trim()) {
      setError('Bitte Name, Email, Position und Motivation ausfüllen.');
      return;
    }

    setSubmitting(true);
    try {
      let response: Response;

      if (resume) {
        // multipart/form-data (nur wenn PDF dabei)
        const fd = new FormData();
        fd.append('name', form.name.trim());
        fd.append('email', form.email.trim());
        fd.append('position', form.position);
        fd.append('motivation', form.motivation.trim());
        if (form.phone.trim()) fd.append('phone', form.phone.trim());
        if (form.available_from) fd.append('available_from', form.available_from);
        if (form.hours_per_week) fd.append('hours_per_week', form.hours_per_week);
        if (form.preferred_times.trim()) fd.append('preferred_times', form.preferred_times.trim());
        fd.append('resume', resume);

        response = await fetch(`${API_URL}/api/applications`, {
          method: 'POST',
          body: fd,
        });
      } else {
        // JSON
        const payload: Record<string, unknown> = {
          name: form.name.trim(),
          email: form.email.trim(),
          position: form.position,
          motivation: form.motivation.trim(),
        };
        if (form.phone.trim()) payload.phone = form.phone.trim();
        if (form.available_from) payload.available_from = form.available_from;
        if (form.hours_per_week) payload.hours_per_week = Number(form.hours_per_week);
        if (form.preferred_times.trim()) payload.preferred_times = form.preferred_times.trim();

        response = await fetch(`${API_URL}/api/applications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Fehler beim Senden. Bitte später erneut versuchen.');
        setSubmitting(false);
        return;
      }

      setSuccess(true);
      setForm(INITIAL_STATE);
      setResume(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      setError('Netzwerkfehler. Bitte Internetverbindung prüfen.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-garden-100 p-10 text-center">
        <div className="text-5xl mb-4">✉️</div>
        <h3 className="font-display text-2xl font-semibold text-garden-900 mb-3">
          Deine Bewerbung ist angekommen
        </h3>
        <p className="text-gray-700 leading-relaxed mb-4">
          Vielen Dank! Wir haben dir eine Bestätigungsmail geschickt. Darin
          findest du auch einen <strong>Reclaim-Link</strong>, mit dem du deine
          Bewerbung später noch ergänzen oder zurückziehen kannst.
        </p>
        <p className="text-sm text-gray-500">
          Wir melden uns persönlich — in der Regel innerhalb weniger Tage.
        </p>
        <button
          onClick={() => setSuccess(false)}
          className="mt-6 text-sm text-garden-700 hover:text-garden-900 underline"
        >
          Weitere Bewerbung senden
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl shadow-sm border border-garden-100 p-6 md:p-8 space-y-5"
      noValidate
    >
      {/* Name + Email */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="app-name" className="block text-sm font-medium text-gray-700 mb-1.5">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="app-name"
            type="text"
            required
            value={form.name}
            onChange={e => update('name', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-garden-500 focus:ring-1 focus:ring-garden-500 outline-none transition"
            placeholder="Vor- und Nachname"
          />
        </div>
        <div>
          <label htmlFor="app-email" className="block text-sm font-medium text-gray-700 mb-1.5">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="app-email"
            type="email"
            required
            value={form.email}
            onChange={e => update('email', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-garden-500 focus:ring-1 focus:ring-garden-500 outline-none transition"
            placeholder="du@beispiel.de"
          />
        </div>
      </div>

      {/* Phone + Position */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="app-phone" className="block text-sm font-medium text-gray-700 mb-1.5">
            Telefon <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="app-phone"
            type="tel"
            value={form.phone}
            onChange={e => update('phone', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-garden-500 focus:ring-1 focus:ring-garden-500 outline-none transition"
            placeholder="+49 ..."
          />
        </div>
        <div>
          <label htmlFor="app-position" className="block text-sm font-medium text-gray-700 mb-1.5">
            Position <span className="text-red-500">*</span>
          </label>
          <select
            id="app-position"
            required
            value={form.position}
            onChange={e => update('position', e.target.value as Position)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-garden-500 focus:ring-1 focus:ring-garden-500 outline-none transition bg-white"
          >
            <option value="">-- Bitte wählen --</option>
            {POSITION_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Verfügbarkeit + Stunden */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="app-available" className="block text-sm font-medium text-gray-700 mb-1.5">
            Verfügbar ab <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            id="app-available"
            type="date"
            value={form.available_from}
            onChange={e => update('available_from', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-garden-500 focus:ring-1 focus:ring-garden-500 outline-none transition"
          />
        </div>
        <div>
          <label htmlFor="app-hours" className="block text-sm font-medium text-gray-700 mb-1.5">
            Stunden/Woche <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <select
            id="app-hours"
            value={form.hours_per_week}
            onChange={e => update('hours_per_week', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-garden-500 focus:ring-1 focus:ring-garden-500 outline-none transition bg-white"
          >
            <option value="">-- keine Angabe --</option>
            {HOURS_OPTIONS.map(h => (
              <option key={h} value={h}>{h} Stunden</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bevorzugte Zeiten */}
      <div>
        <label htmlFor="app-times" className="block text-sm font-medium text-gray-700 mb-1.5">
          Bevorzugte Zeiten <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="app-times"
          type="text"
          value={form.preferred_times}
          onChange={e => update('preferred_times', e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-garden-500 focus:ring-1 focus:ring-garden-500 outline-none transition"
          placeholder="z.B. Wochenende, Vormittags, flexibel"
        />
      </div>

      {/* Motivation */}
      <div>
        <label htmlFor="app-motivation" className="block text-sm font-medium text-gray-700 mb-1.5">
          Motivation <span className="text-red-500">*</span>
        </label>
        <textarea
          id="app-motivation"
          required
          rows={6}
          value={form.motivation}
          onChange={e => update('motivation', e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-garden-500 focus:ring-1 focus:ring-garden-500 outline-none transition resize-y"
          placeholder="Erzähl uns, warum du Teil von Refugium Naturgärten werden möchtest. Was bringst du mit? Was reizt dich am Projekt?"
        />
      </div>

      {/* Lebenslauf */}
      <div>
        <label htmlFor="app-resume" className="block text-sm font-medium text-gray-700 mb-1.5">
          Lebenslauf (PDF) <span className="text-gray-400 font-normal">(optional, max {MAX_RESUME_MB} MB)</span>
        </label>
        <input
          id="app-resume"
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-garden-50 file:text-garden-700 hover:file:bg-garden-100 cursor-pointer"
        />
        {resume && (
          <p className="mt-1.5 text-xs text-garden-700">
            ✓ {resume.name} ({(resume.size / 1024).toFixed(0)} KB)
          </p>
        )}
        {resumeError && (
          <p className="mt-1.5 text-xs text-red-600">{resumeError}</p>
        )}
      </div>

      {/* Fehler */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-2">
        <p className="text-xs text-gray-500">
          Mit dem Absenden stimmst du der Verarbeitung deiner Daten gemäß{' '}
          <a href="/datenschutz" className="underline hover:text-garden-700">Datenschutzerklärung</a> zu.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="bg-garden-700 hover:bg-garden-800 disabled:bg-gray-400 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition shadow-sm whitespace-nowrap"
        >
          {submitting ? 'Wird gesendet ...' : 'Bewerbung absenden'}
        </button>
      </div>
    </form>
  );
}
