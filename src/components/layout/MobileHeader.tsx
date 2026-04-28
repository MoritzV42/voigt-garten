import { useState, useEffect } from "react";
import { HelpCircle, LogIn, Globe } from "lucide-react";

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
  const [lang, setLang] = useState("de");

  useEffect(() => {
    const storedUser = localStorage.getItem("voigt-garten-user");
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {}
    }

    const storedLang = localStorage.getItem("voigt-garten-lang");
    if (storedLang) setLang(storedLang);

    const handleAuth = (e: CustomEvent) => {
      setUser(e.detail?.user || null);
    };
    window.addEventListener("auth-change", handleAuth as EventListener);
    return () => window.removeEventListener("auth-change", handleAuth as EventListener);
  }, []);

  const toggleLang = () => {
    const newLang = lang === "de" ? "en" : "de";
    setLang(newLang);
    localStorage.setItem("voigt-garten-lang", newLang);
    window.location.reload();
  };

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
          <img
            src="/images/logo-mark.png"
            alt="Refugium Heideland"
            width={32}
            height={32}
            className="h-8 w-8"
          />
          <span className="font-display text-base font-semibold text-garden-800">Refugium</span>
        </a>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleLang}
            aria-label={lang === "de" ? "Switch to English" : "Auf Deutsch wechseln"}
            title={lang === "de" ? "Switch to English" : "Auf Deutsch wechseln"}
            className="flex h-9 items-center justify-center gap-1 rounded-full border border-garden-200 px-2 text-gray-500 transition hover:border-garden-400 hover:text-garden-700"
            data-no-translate
          >
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="text-xs font-medium uppercase">{lang === "de" ? "EN" : "DE"}</span>
          </button>

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
