import { useEffect, useRef, useState } from 'react';

interface Props {
  itemId: number;
  token: string;
  pollIntervalSeconds?: number;
  maxWaitSeconds?: number;
  infiniloopUrl?: string;
  onClose?: () => void;
}

type Phase = 'waiting' | 'question' | 'answering' | 'resolved' | 'error';

const DEFAULT_URL = 'https://infiniloop.infinityspace42.de';
const MAX_ROUNDS = 2;

export default function InfiniLoopFollowUp({
  itemId,
  token,
  pollIntervalSeconds = 2,
  maxWaitSeconds = 30,
  infiniloopUrl,
  onClose,
}: Props) {
  const baseUrl = (infiniloopUrl || DEFAULT_URL).replace(/\/+$/, '');
  const [phase, setPhase] = useState<Phase>('waiting');
  const [remainingSeconds, setRemainingSeconds] = useState(maxWaitSeconds);
  const [questionText, setQuestionText] = useState<string>('');
  const [answer, setAnswer] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [rounds, setRounds] = useState(0);
  const lastQuestionTsRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  function stopTimers() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }

  async function fetchStatus() {
    try {
      const url = `${baseUrl}/api/external/feedback_status?item_id=${encodeURIComponent(
        String(itemId)
      )}&token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { method: 'GET' });
      if (!mountedRef.current) return;
      if (!res.ok) {
        // 401/404 → beenden, kein Dauer-Retry
        if (res.status === 401 || res.status === 404) {
          stopTimers();
          setPhase('resolved');
        }
        return;
      }
      const data = await res.json();
      if (!mountedRef.current) return;

      if (data.status === 'resolved') {
        stopTimers();
        setPhase('resolved');
        return;
      }

      if (data.status === 'question' && data.question_text) {
        const ts = data.question_ts || data.question_text;
        if (ts !== lastQuestionTsRef.current) {
          lastQuestionTsRef.current = ts;
          stopTimers();
          setQuestionText(data.question_text);
          setAnswer('');
          setPhase('question');
        }
      }
    } catch {
      // still fallen — weiter pollen
    }
  }

  function startPolling() {
    stopTimers();
    setRemainingSeconds(maxWaitSeconds);
    // sofort einmal pollen + dann im Intervall
    void fetchStatus();
    pollTimerRef.current = setInterval(() => {
      void fetchStatus();
    }, Math.max(1, pollIntervalSeconds) * 1000);
    countdownTimerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          stopTimers();
          setPhase((p) => (p === 'waiting' ? 'resolved' : p));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    mountedRef.current = true;
    startPolling();
    return () => {
      mountedRef.current = false;
      stopTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, token]);

  async function submitAnswer() {
    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      setErrorMessage('Bitte eine Antwort eingeben.');
      return;
    }
    setErrorMessage('');
    setPhase('answering');
    try {
      const res = await fetch(`${baseUrl}/api/external/feedback_answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, token, answer: trimmed }),
      });
      if (!res.ok) {
        if (res.status === 410) {
          stopTimers();
          setPhase('resolved');
          return;
        }
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setAnswer('');
      setQuestionText('');
      const nextRound = rounds + 1;
      setRounds(nextRound);
      if (nextRound >= MAX_ROUNDS) {
        stopTimers();
        setPhase('resolved');
        return;
      }
      setPhase('waiting');
      startPolling();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Senden fehlgeschlagen';
      setErrorMessage(msg);
      setPhase('question');
    }
  }

  const progressPct = Math.max(0, Math.min(100, (remainingSeconds / maxWaitSeconds) * 100));

  return (
    <div className="p-6">
      {phase === 'waiting' && (
        <div className="text-center">
          <div className="text-4xl mb-3">⏳</div>
          <h3 className="text-lg font-bold text-gray-900 mb-1">Warten auf Rückfragen …</h3>
          <p className="text-sm text-gray-600 mb-4">
            InfiniLoop prüft dein Feedback kurz auf Rückfragen. Nach spätestens {maxWaitSeconds} Sekunden
            bekommst du Bescheid.
          </p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-garden-600 transition-all duration-1000 ease-linear"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">Noch {remainingSeconds} s …</p>
        </div>
      )}

      {(phase === 'question' || phase === 'answering') && (
        <div>
          <div className="mb-3 flex items-start gap-2">
            <div className="text-2xl">💬</div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Rückfrage</h3>
              <p className="text-xs text-gray-500">
                InfiniLoop hat eine kurze Rückfrage zu deiner Meldung.
              </p>
            </div>
          </div>
          <div className="mb-3 rounded-lg border border-garden-100 bg-garden-50 px-4 py-3 text-sm text-garden-900 whitespace-pre-wrap">
            {questionText}
          </div>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={phase === 'answering'}
            rows={4}
            placeholder="Deine Antwort …"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-garden-600 focus:outline-none focus:ring-1 focus:ring-garden-600 disabled:opacity-60"
          />
          {errorMessage && (
            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {errorMessage}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={submitAnswer}
              disabled={phase === 'answering'}
              className="flex-1 rounded-lg bg-garden-700 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-garden-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {phase === 'answering' ? 'Wird gesendet …' : 'Antwort senden'}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={phase === 'answering'}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
              >
                Später
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'resolved' && (
        <div className="text-center">
          <div className="text-5xl mb-3">✅</div>
          <h3 className="text-lg font-bold text-green-700 mb-2">Alles klar, keine Rückfragen.</h3>
          <p className="text-sm text-gray-600 mb-4">
            Vielen Dank! Bitte schau morgen nochmal vorbei, wir halten dich dann über den Bearbeitungsstand
            auf dem Laufenden.
          </p>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-garden-700 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-garden-800"
            >
              Schließen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
