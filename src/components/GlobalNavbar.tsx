import { useState, useEffect } from 'react';
import LoginModal from './LoginModal';

interface User {
  id: number;
  email: string;
  username?: string;
  name?: string;
  role: 'user' | 'admin';
}

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://garten.infinityspace42.de';
const TOKEN_KEY = 'voigt-garten-token';
const USER_KEY = 'voigt-garten-user';

export default function GlobalNavbar() {
  const [user, setUser] = useState<User | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedUser = localStorage.getItem(USER_KEY);

    if (storedToken && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
        // Verify token is still valid
        verifyToken(storedToken);
      } catch {
        clearAuth();
      }
    }
    setIsLoading(false);

    // Listen for auth changes from other components
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY || e.key === USER_KEY) {
        if (e.newValue) {
          try {
            if (e.key === USER_KEY) {
              setUser(JSON.parse(e.newValue));
            }
          } catch {}
        } else {
          setUser(null);
        }
      }
    };

    // Custom event for same-tab updates
    const handleAuthChange = (e: CustomEvent) => {
      if (e.detail?.user) {
        setUser(e.detail.user);
      } else {
        setUser(null);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('auth-change', handleAuthChange as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('auth-change', handleAuthChange as EventListener);
    };
  }, []);

  const verifyToken = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        clearAuth();
      }
    } catch {
      // Keep local user if offline
    }
  };

  const clearAuth = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  };

  const handleLogout = async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      try {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      } catch {}
    }
    clearAuth();
    setShowDropdown(false);
    // Dispatch custom event for same-tab updates
    window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: null } }));
  };

  const handleLoginSuccess = () => {
    // Reload user from storage
    const storedUser = localStorage.getItem(USER_KEY);
    if (storedUser) {
      try {
        const userData = JSON.parse(storedUser);
        setUser(userData);
        // Dispatch custom event for same-tab updates
        window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: userData } }));
      } catch {}
    }
    setShowLoginModal(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
      </div>
    );
  }

  return (
    <>
      {user ? (
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-garden-50 transition"
          >
            <div className="w-8 h-8 rounded-full bg-garden-600 text-white flex items-center justify-center text-sm font-medium">
              {user.name?.charAt(0) || user.username?.charAt(0) || user.email.charAt(0).toUpperCase()}
            </div>
            <span className="hidden md:block text-sm text-gray-700">
              {user.name || user.username || user.email.split('@')[0]}
            </span>
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showDropdown && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowDropdown(false)}
              />
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                <div className="px-4 py-2 border-b border-gray-100">
                  <div className="font-medium text-gray-900">{user.name || user.username}</div>
                  <div className="text-sm text-gray-500">{user.email}</div>
                  {user.role === 'admin' && (
                    <span className="inline-block mt-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                      Admin
                    </span>
                  )}
                </div>
                <a
                  href="/wartung"
                  className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => setShowDropdown(false)}
                >
                  Wartungsaufgaben
                </a>
                {user.role === 'admin' && (
                  <a
                    href="/admin"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => setShowDropdown(false)}
                  >
                    Admin-Dashboard
                  </a>
                )}
                <div className="border-t border-gray-100 mt-2 pt-2">
                  <button
                    onClick={handleLogout}
                    className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    Abmelden
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          onClick={() => setShowLoginModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-garden-600 hover:bg-garden-700 text-white rounded-lg text-sm font-medium transition"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span className="hidden sm:inline">Anmelden</span>
        </button>
      )}

      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onSuccess={handleLoginSuccess}
      />
    </>
  );
}
