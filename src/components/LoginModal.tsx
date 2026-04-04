import { useState } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';
const TOKEN_KEY = 'voigt-garten-token';
const USER_KEY = 'voigt-garten-user';

export default function LoginModal({ isOpen, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailOrUsername,
          username: emailOrUsername,
          password
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        // Dispatch custom event for same-tab updates
        window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: data.user } }));
        resetForm();
        if (onSuccess) {
          onSuccess();
        } else {
          onClose();
        }
      } else {
        setError(data.error || 'Anmeldung fehlgeschlagen');
      }
    } catch (err) {
      setError('Verbindungsfehler. Bitte erneut versuchen.');
    }

    setIsLoading(false);
  };

  const handleRequestMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/request-magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setMagicLinkSent(true);
      } else {
        setError(data.error || 'Fehler beim Senden des Links');
      }
    } catch (err) {
      setError('Verbindungsfehler. Bitte erneut versuchen.');
    }

    setIsLoading(false);
  };

  const resetForm = () => {
    setEmailOrUsername('');
    setPassword('');
    setConfirmPassword('');
    setEmail('');
    setUsername('');
    setName('');
    setError('');
    setMagicLinkSent(false);
  };

  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setError('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl"
        >
          &times;
        </button>

        {/* Tab Switcher */}
        <div className="flex border-b border-gray-200 mb-6">
          <button
            onClick={() => switchMode('login')}
            className={`flex-1 py-3 text-center font-medium transition ${
              mode === 'login'
                ? 'text-garden-600 border-b-2 border-garden-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Anmelden
          </button>
          <button
            onClick={() => switchMode('register')}
            className={`flex-1 py-3 text-center font-medium transition ${
              mode === 'register'
                ? 'text-garden-600 border-b-2 border-garden-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Registrieren
          </button>
        </div>

        {/* Google Login Button */}
        <button
          onClick={async () => {
            try {
              const res = await fetch(`${API_URL}/api/auth/google/url`);
              const data = await res.json();
              if (data.url) {
                window.location.href = data.url;
              } else {
                setError(data.error || 'Google-Anmeldung nicht verfuegbar');
              }
            } catch {
              setError('Verbindungsfehler');
            }
          }}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Mit Google anmelden
        </button>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-gray-500">oder</span>
          </div>
        </div>

        {mode === 'login' ? (
          /* Login Form */
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email oder Username
              </label>
              <input
                type="text"
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500"
                placeholder="email@example.com"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Passwort
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500"
                placeholder="********"
                required
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white py-3 rounded-lg font-medium transition"
            >
              {isLoading ? 'Wird angemeldet...' : 'Anmelden'}
            </button>
          </form>
        ) : (
          /* Register Form - Magic Link */
          magicLinkSent ? (
            <div className="text-center py-6">
              <div className="text-5xl mb-4">📧</div>
              <h3 className="text-lg font-semibold text-gray-800 mb-2">
                Pruefe dein Postfach!
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Wir haben einen Bestaetigungslink an<br />
                <strong className="text-garden-700">{email}</strong><br />
                gesendet.
              </p>
              <p className="text-gray-500 text-xs mb-6">
                Der Link ist 30 Minuten gueltig. Pruefe auch deinen Spam-Ordner.
              </p>
              <button
                onClick={() => { setMagicLinkSent(false); setEmail(''); setName(''); }}
                className="text-garden-600 hover:text-garden-700 text-sm font-medium transition"
              >
                Andere Email-Adresse verwenden
              </button>
            </div>
          ) : (
            <form onSubmit={handleRequestMagicLink} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email-Adresse *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500"
                  placeholder="email@example.com"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-gray-400 text-xs">(optional)</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500"
                  placeholder="Max Mustermann"
                />
              </div>

              {error && (
                <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white py-3 rounded-lg font-medium transition"
              >
                {isLoading ? 'Wird gesendet...' : 'Magic Link senden'}
              </button>

              <p className="text-xs text-gray-500 text-center">
                Wir senden dir einen Link per Email, um deinen Account zu erstellen oder dich anzumelden.
              </p>
            </form>
          )
        )}

        <p className="mt-4 text-sm text-gray-500 text-center">
          {mode === 'login'
            ? 'Noch kein Account? Wechsle zu Registrieren!'
            : 'Bereits registriert? Wechsle zu Anmelden!'
          }
        </p>
      </div>
    </div>
  );
}
