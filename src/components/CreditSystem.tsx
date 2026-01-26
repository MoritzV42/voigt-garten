import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface CreditEntry {
  id: string;
  date: string;
  amount: number;
  reason: string;
  type: 'earned' | 'used';
}

export default function CreditSystem() {
  const [email, setEmail] = useState('');
  const [credits, setCredits] = useState<CreditEntry[]>([]);
  const [totalCredits, setTotalCredits] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Check for saved email on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('voigt-garten-email');
    if (savedEmail) {
      setEmail(savedEmail);
      loadCredits(savedEmail);
    }
  }, []);

  const loadCredits = async (userEmail: string) => {
    setIsLoading(true);

    // PLACEHOLDER: Fetch from API
    // const response = await fetch(`/api/credits?email=${userEmail}`);
    // const data = await response.json();

    // Demo data
    await new Promise(resolve => setTimeout(resolve, 500));

    const demoCredits: CreditEntry[] = [
      { id: '1', date: '2026-01-15', amount: 15, reason: 'Rasenmähen', type: 'earned' },
      { id: '2', date: '2026-01-10', amount: 20, reason: 'Unkraut jäten', type: 'earned' },
      { id: '3', date: '2026-01-05', amount: -25, reason: 'Buchung 05.-07.01.', type: 'used' },
    ];

    setCredits(demoCredits);
    setTotalCredits(demoCredits.reduce((sum, c) => sum + c.amount, 0));
    setIsLoggedIn(true);
    setIsLoading(false);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    localStorage.setItem('voigt-garten-email', email);
    loadCredits(email);
  };

  const handleLogout = () => {
    localStorage.removeItem('voigt-garten-email');
    setEmail('');
    setCredits([]);
    setTotalCredits(0);
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return (
      <form onSubmit={handleLogin} className="space-y-4">
        <p className="text-sm text-gray-600">
          Gib deine Email ein, um dein Guthaben zu sehen:
        </p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="deine@email.de"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={isLoading || !email}
          className="w-full bg-garden-600 hover:bg-garden-700 disabled:bg-gray-400 text-white py-2 rounded-lg font-medium transition"
        >
          {isLoading ? 'Lädt...' : 'Guthaben anzeigen'}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {/* Total Balance */}
      <div className="bg-garden-100 rounded-lg p-4 text-center">
        <div className="text-3xl font-bold text-garden-700">{totalCredits}€</div>
        <div className="text-sm text-garden-600">Verfügbares Guthaben</div>
      </div>

      {/* User Info */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600">{email}</span>
        <button onClick={handleLogout} className="text-gray-500 hover:text-gray-700 underline">
          Abmelden
        </button>
      </div>

      {/* Transaction History */}
      <div>
        <h4 className="font-medium text-gray-700 mb-2">Letzte Bewegungen:</h4>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {credits.length === 0 ? (
            <p className="text-sm text-gray-500">Noch keine Einträge</p>
          ) : (
            credits.map(credit => (
              <div key={credit.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg p-2">
                <div>
                  <div className="font-medium text-gray-800">{credit.reason}</div>
                  <div className="text-xs text-gray-500">
                    {format(new Date(credit.date), 'dd.MM.yyyy', { locale: de })}
                  </div>
                </div>
                <div className={`font-bold ${credit.type === 'earned' ? 'text-green-600' : 'text-red-600'}`}>
                  {credit.type === 'earned' ? '+' : ''}{credit.amount}€
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Info */}
      <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
        <strong>Tipp:</strong> Dein Guthaben wird automatisch bei der nächsten Buchung verrechnet.
        Du kannst es auch an andere Familienmitglieder übertragen.
      </div>
    </div>
  );
}
