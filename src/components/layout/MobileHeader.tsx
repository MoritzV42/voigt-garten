import { useState, useEffect } from "react";
import { HelpCircle, LogIn } from "lucide-react";

interface User {
  id: number;
  email: string;
  username?: string;
  name?: string;
  role: "user" | "admin";
  profile_image_url?: string;
}

export default function MobileHeader() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("voigt-garten-user");
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {}
    }

    const handleAuth = (e: CustomEvent) => {
      setUser(e.detail?.user || null);
    };
    window.addEventListener("auth-change", handleAuth as EventListener);
    return () => window.removeEventListener("auth-change", handleAuth as EventListener);
  }, []);

  const initials = user
    ? (user.name || user.username || user.email)
        .split(" ")
        .map((p) => p[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

  return (
    <header
      className="sticky top-0 z-30 border-b border-garden-200 bg-white/95 backdrop-blur lg:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex h-14 items-center justify-between px-4">
        {/* Logo Mark */}
        <a href="/" className="flex items-center gap-2">
          <span className="text-2xl leading-none">🌳</span>
          <span className="font-display text-base font-semibold text-garden-800">Refugium</span>
        </a>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("start-page-help"))}
            aria-label="Hilfe"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-garden-200 text-gray-500 transition hover:border-garden-400 hover:text-garden-700"
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </button>

          {user ? (
            <a
              href={user.role === "admin" ? "/admin" : "/taskmanagement"}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-garden-700 text-xs font-semibold text-white"
            >
              {user.profile_image_url ? (
                <img
                  src={user.profile_image_url}
                  alt=""
                  className="h-9 w-9 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                initials || "?"
              )}
            </a>
          ) : (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("open-login"))}
              aria-label="Anmelden"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-garden-700 text-white transition hover:bg-garden-600"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
