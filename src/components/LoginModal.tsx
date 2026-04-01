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
