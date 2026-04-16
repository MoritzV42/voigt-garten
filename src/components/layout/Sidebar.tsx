import { useState, useEffect } from "react";
import { NAV_SECTIONS, ICON_MAP, type NavSection, type IconName } from "./nav-items";
import { HelpCircle, LogOut, LogIn, Shield, Globe } from "lucide-react";

interface User {
  id: number;
  email: string;
  username?: string;
  name?: string;
  role: "user" | "admin";
  profile_image_url?: string;
}

function NavIcon({ name, className }: { name: IconName; className?: string }) {
  const Cmp = ICON_MAP[name];
  return <Cmp className={className} aria-hidden="true" />;
}

function SidebarLink({
  href,
  label,
  icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: IconName;
  pathname: string;
}) {
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <a
      href={href}
      className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "bg-earth-500/15 text-earth-300"
          : "text-garden-200/70 hover:bg-white/5 hover:text-garden-100"
      }`}
    >
      <NavIcon
        name={icon}
        className={`h-[18px] w-[18px] shrink-0 transition ${
          active ? "text-earth-400" : "text-garden-300/50 group-hover:text-garden-200"
        }`}
      />
      <span>{label}</span>
    </a>
  );
}

function SidebarSection({
  section,
  pathname,
}: {
  section: NavSection;
  pathname: string;
}) {
  return (
    <div>
      <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-garden-300/40">
        {section.title}
      </p>
      <div className="space-y-0.5">
        {section.items.map((item) => (
          <SidebarLink key={item.href} {...item} pathname={pathname} />
        ))}
      </div>
    </div>
  );
}

export default function Sidebar({ pathname = "/" }: { pathname?: string }) {
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
    // Astro islands are isolated React roots — reload to apply lang everywhere
    window.location.reload();
  };

  const handleLogout = async () => {
    const token = localStorage.getItem("voigt-garten-token");
    if (token) {
      try {
        const API_URL = import.meta.env.PUBLIC_API_URL || "https://garten.infinityspace42.de";
        await fetch(`${API_URL}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }
    localStorage.removeItem("voigt-garten-token");
    localStorage.removeItem("voigt-garten-user");
    setUser(null);
    window.dispatchEvent(new CustomEvent("auth-change", { detail: { user: null } }));
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
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-[264px] lg:flex-col lg:border-r lg:border-garden-800/50 lg:bg-garden-900 lg:text-garden-100">
      {/* Logo */}
      <div className="px-6 pt-7 pb-6">
        <a href="/" className="flex items-center gap-2.5">
          <img
            src="/images/logo-mark-white.png"
            alt="Refugium Heideland"
            width={36}
            height={36}
            className="h-9 w-9 shrink-0"
          />
          <div>
            <div className="font-display text-lg font-semibold tracking-tight text-white">
              Refugium
            </div>
            <div className="text-[11px] font-medium tracking-wide text-garden-400">
              Heideland
            </div>
          </div>
        </a>
      </div>

      {/* Nav Sections */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4" data-tutorial="nav-links">
        {NAV_SECTIONS.map((section) => (
          <SidebarSection key={section.title} section={section} pathname={pathname} />
        ))}

        {/* Help Button */}
        <div className="px-1 pt-2">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("start-page-help"))}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-garden-200/70 transition hover:bg-white/5 hover:text-garden-100"
          >
            <HelpCircle className="h-[18px] w-[18px] text-garden-300/50" aria-hidden="true" />
            <span>Hilfe</span>
          </button>
        </div>
      </nav>

      {/* Bottom: Language + User */}
      <div className="border-t border-garden-800/60 p-4 space-y-3">
        {/* Language Toggle */}
        <button
          onClick={toggleLang}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-garden-200/70 transition hover:bg-white/5 hover:text-garden-100"
        >
          <Globe className="h-[18px] w-[18px] text-garden-300/50" aria-hidden="true" />
          <span>{lang === "de" ? "English" : "Deutsch"}</span>
          <span className="ml-auto text-xs font-medium text-garden-400 uppercase">{lang}</span>
        </button>

        {/* User Section */}
        {user ? (
          <div>
            <div className="flex items-center gap-3 px-1 mb-3">
              {user.profile_image_url ? (
                <img
                  src={user.profile_image_url}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-earth-500/20 text-sm font-semibold text-earth-400">
                  {initials || "?"}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-garden-100">
                  {user.name || user.username || user.email.split("@")[0]}
                </div>
                <div className="truncate text-[11px] text-garden-400">
                  {user.email}
                </div>
              </div>
            </div>

            {user.role === "admin" && (
              <a
                href="/admin"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-garden-200/70 transition hover:bg-white/5 hover:text-garden-100 mb-2"
              >
                <Shield className="h-[18px] w-[18px] text-garden-300/50" aria-hidden="true" />
                <span>Admin-Dashboard</span>
              </a>
            )}

            <button
              onClick={handleLogout}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-garden-700/40 bg-white/5 px-3 py-2 text-xs font-medium uppercase tracking-wider text-garden-300/80 transition hover:border-earth-500/40 hover:text-earth-400"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Abmelden
            </button>
          </div>
        ) : (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("open-login"));
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-earth-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-earth-500"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Anmelden
          </a>
        )}
      </div>
    </aside>
  );
}
