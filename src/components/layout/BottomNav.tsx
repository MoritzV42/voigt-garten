import { useState, useEffect, useCallback } from "react";
import { BOTTOM_NAV_ITEMS, getAllItems, ICON_MAP, type IconName } from "./nav-items";
import { Menu, X } from "lucide-react";

const MAX_VISIBLE = 4;

function NavIcon({ name, className }: { name: IconName; className?: string }) {
  const Cmp = ICON_MAP[name];
  return <Cmp className={className} aria-hidden="true" />;
}

export default function BottomNav({ pathname = "/" }: { pathname?: string }) {
  const [moreOpen, setMoreOpen] = useState(false);

  // Close drawer on Escape
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  const visibleItems = BOTTOM_NAV_ITEMS.slice(0, MAX_VISIBLE);
  const allItems = getAllItems();
  const primaryHrefs = new Set(visibleItems.map((i) => i.href));
  const moreItems = allItems.filter((i) => !primaryHrefs.has(i.href));

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <>
      {/* Backdrop */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={closeMore}
          aria-hidden="true"
        />
      )}

      {/* More-Drawer */}
      {moreOpen && (
        <div className="fixed inset-x-0 bottom-0 z-50 lg:hidden">
          <div className="mx-auto max-w-lg rounded-t-2xl border border-garden-200 bg-white p-5 pb-2 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Alle Bereiche</h2>
              <button
                onClick={closeMore}
                className="rounded-full p-1.5 text-gray-400 hover:bg-garden-50 hover:text-gray-700"
                aria-label="Schließen"
              >
                <X className="h-[18px] w-[18px]" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1 pb-4">
              {moreItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-medium transition ${
                      active
                        ? "bg-garden-100 text-garden-800"
                        : "text-gray-500 hover:bg-garden-50 hover:text-gray-800"
                    }`}
                  >
                    <NavIcon
                      name={item.icon}
                      className={`h-5 w-5 ${active ? "text-garden-700" : "text-gray-400"}`}
                    />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </div>
          </div>
          {/* Spacer so bottom-nav doesn't overlap drawer */}
          <div
            className="bg-white"
            style={{ height: "calc(56px + env(safe-area-inset-bottom))" }}
          />
        </div>
      )}

      {/* Bottom Nav Bar */}
      <nav
        aria-label="Navigation"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-garden-200 bg-white/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex max-w-xl items-stretch justify-between px-2">
          {visibleItems.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href} className="flex-1">
                <a
                  href={item.href}
                  className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition ${
                    active ? "text-garden-700" : "text-gray-400 hover:text-gray-700"
                  }`}
                >
                  <span className="relative">
                    <NavIcon
                      name={item.icon}
                      className={`h-5 w-5 ${active ? "text-garden-700" : "text-gray-400"}`}
                    />
                  </span>
                  <span>{item.label}</span>
                  {active && (
                    <span className="absolute top-1 left-1/2 -translate-x-1/2 h-0.5 w-6 rounded-full bg-garden-600" />
                  )}
                </a>
              </li>
            );
          })}
          {/* Mehr-Button */}
          <li className="flex-1">
            <button
              onClick={() => setMoreOpen((o) => !o)}
              className={`relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition ${
                moreOpen ? "text-garden-700" : "text-gray-400 hover:text-gray-700"
              }`}
            >
              <Menu className={`h-5 w-5 ${moreOpen ? "text-garden-700" : "text-gray-400"}`} />
              <span>Mehr</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
