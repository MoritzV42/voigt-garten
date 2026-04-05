import { useState, useEffect } from 'react';

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';
const TOKEN_KEY = 'voigt-garten-token';
const USER_KEY = 'voigt-garten-user';

type Status = 'loading' | 'needs_password' | 'success' | 'error';

export default function VerifyPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');

  // Registration form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');

    if (!urlToken) {
      setStatus('error');
      setError('Kein Verifizierungs-Token gefunden.');
      return;
    }

    setToken(urlToken);
    verifyToken(urlToken);
  }, []);

  const verifyToken = async (t: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/verify-email?token=${encodeURIComponent(t)}`);
      const data = await response.json();

      if (!response.ok) {
        setStatus('error');
        setError(data.error || 'Token ungültig oder abgelaufen.');
        return;
      }

      if (data.authenticated) {
        // Existing user - auto login
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: data.user } }));
        setStatus('success');
        // Redirect after short delay
        setTimeout(() => {
          window.location.href = '/';
        }, 2000);
      } else if (data.needs_password) {
        setEmail(data.email);
        setToken(data.token);
        setStatus('needs_password');
      }
    } catch (err) {
      setStatus('error');
      setError('Verbindungsfehler. Bitte versuche es erneut.');
    }
  };

  const handleCompleteRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (password !== confirmPassword) {
      setFormError('Passwörter stimmen nicht überein');
      return;
    }

    if (password.length < 6) {
      setFormError('Passwort muss mindestens 6 Zeichen haben');
      return;
    }

    if (username.length < 3) {
      setFormError('Username muss mindestens 3 Zeichen haben');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/api/auth/complete-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, username, name })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: data.user } }));
        setStatus('success');
        setTimeout(() => {
          window.location.href = '/';
        }, 2000);
      } else {
        setFormError(data.error || 'Registrierung fehlgeschlagen');
      }
    } catch (err) {
      setFormError('Verbindungsfehler. Bitte erneut versuchen.');
    }

    setIsSubmitting(false);
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full">
        {status === 'loading' && (
          <div className="text-center">
            <div className="inline-block w-12 h-12 border-4 border-garden-200 border-t-garden-600 rounded-full animate-spin mb-4"></div>
            <h2 className="text-xl font-display font-semibold text-gray-800">
              Email wird verifiziert...
            </h2>
            <p className="text-gray-500 mt-2">Einen Moment bitte.</p>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="text-5xl mb-4">😕</div>
            <h2 className="text-xl font-display font-semibold text-gray-800 mb-2">
              Verifizierung fehlgeschlagen
            </h2>
            <p className="text-red-600 mb-6">{error}</p>
            <a
              href="/"
              className="inline-block bg-garden-600 hover:bg-garden-700 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              Zur Startseite
            </a>
          </div>
        )}

        {status === 'success' && (
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-xl font-display font-semibold text-garden-700 mb-2">
              Willkommen im Voigt-Garten!
            </h2>
            <p className="text-gray-600 mb-4">
              Du wirst gleich weitergeleitet...
            </p>
            <div className="inline-block w-6 h-6 border-2 border-garden-200 border-t-garden-600 rounded-full animate-spin"></div>
          </div>
        )}

        {status === 'needs_password' && (
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="text-center mb-6">
              <div className="text-4xl mb-3">🌳</div>
              <h2 className="text-xl font-display font-semibold text-gray-800">
                Account erstellen
              </h2>
              <p className="text-gray-500 text-sm mt-1">
                Email verifiziert: <strong className="text-garden-700">{email}</strong>
              </p>
            </div>

            <form onSubmit={handleCompleteRegistration} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Username * <span className="text-gray-400 text-xs">(min. 3 Zeichen)</span>
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500"
                  placeholder="mein_username"
                  required
                  minLength={3}
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Passwort * <span className="text-gray-400 text-xs">(min. 6 Zeichen)</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500"
                  placeholder="********"
                  required
                  minLength={6}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Passwort bestätigen *
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500"
                  placeholder="********"
                  required
                />
              </div>

              {formError && (
                <div className="bg-red-50 text-red-700 px-4 py-2 rounded-lg text-sm">
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white py-3 rounded-lg font-medium transition"
              >
                {isSubmitting ? 'Wird erstellt...' : 'Account erstellen'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
