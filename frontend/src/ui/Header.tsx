import { useState } from "react";
import { APP_VERSION } from "../domain/models";
import { ANCHORS } from "../shared/anchors";

export type AppView = "dashboard" | "tags" | "health" | "settings";

interface HeaderProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  activeItemCount: number;
  tagCount: number;
  isChecking: boolean;
  onRunCheck: () => void;
  onOpenAddModal: () => void;
  spreadsheetId: string;
}

export function Header({
  activeView,
  onSelectView,
  activeItemCount,
  tagCount,
  isChecking,
  onRunCheck,
  onOpenAddModal,
  spreadsheetId,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navigate = (view: AppView) => {
    setMenuOpen(false);
    setMobileNavOpen(false);
    onSelectView(view);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl min-w-0 items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center">
          <span className="truncate text-base font-bold tracking-tight text-emerald-400 sm:text-lg">
            PricePulse
          </span>
        </div>

        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-1 md:flex"
        >
          <button
            type="button"
            onClick={() => navigate("dashboard")}
            aria-pressed={activeView === "dashboard"}
            className={`min-h-9 min-w-0 truncate rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              activeView === "dashboard"
                ? "bg-emerald-500/20 text-emerald-300"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => navigate("tags")}
            aria-pressed={activeView === "tags"}
            className={`min-h-9 min-w-0 truncate rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              activeView === "tags"
                ? "bg-emerald-500/20 text-emerald-300"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            Tag Manager
          </button>
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onRunCheck}
            disabled={isChecking}
            aria-busy={isChecking}
            aria-label={`Run Check (${activeItemCount} Items)`}
            className="min-h-11 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50 sm:min-h-9 sm:px-3"
          >
            {isChecking ? (
              "Checking..."
            ) : (
              <>
                <span className="sm:hidden">Check ({activeItemCount})</span>
                <span className="hidden sm:inline">
                  Run Check ({activeItemCount} Items)
                </span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onOpenAddModal}
            aria-label="+ Track New URL"
            className="min-h-11 whitespace-nowrap rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 sm:min-h-9 sm:px-3"
          >
            <span className="sm:hidden">+ Track</span>
            <span className="hidden sm:inline">+ Track New URL</span>
          </button>

          <div className="relative">
            <button
              type="button"
              aria-label="User account menu"
              aria-expanded={menuOpen}
              aria-controls={ANCHORS.userDropdownMenu}
              onClick={() => {
                setMobileNavOpen(false);
                setMenuOpen((prev) => !prev);
              }}
              className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-800 sm:min-h-9 sm:min-w-0 sm:px-2.5"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 font-semibold text-emerald-300">
                PP
              </span>
              <span className="hidden sm:inline">Owner</span>
            </button>

            {menuOpen && (
              <div
                id={ANCHORS.userDropdownMenu}
                role="menu"
                aria-label="Account and system navigation"
                className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-800 bg-slate-900 py-2 text-xs shadow-2xl"
              >
                <div className="border-b border-slate-800 px-3 py-2 text-slate-400">
                  <div className="font-medium text-emerald-300">
                    {activeItemCount} Positions &amp; {tagCount} Tags Synced
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    v{APP_VERSION}
                  </div>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => navigate("health")}
                  className="block min-h-11 w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800 sm:min-h-9"
                >
                  System Health (Logs review)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => navigate("tags")}
                  className="block min-h-11 w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800 sm:min-h-9"
                >
                  Tag Manager
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => navigate("settings")}
                  className="block min-h-11 w-full px-3 py-2 text-left text-slate-200 hover:bg-slate-800 sm:min-h-9"
                >
                  G-Sync &amp; Configuration
                </button>
                {spreadsheetId && (
                  <a
                    role="menuitem"
                    href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block min-h-11 w-full px-3 py-2 text-left text-emerald-300 hover:bg-slate-800 sm:min-h-9"
                  >
                    Open Google Sheet
                  </a>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileNavOpen}
            aria-controls={ANCHORS.mobileNavDrawer}
            onClick={() => {
              setMenuOpen(false);
              setMobileNavOpen((prev) => !prev);
            }}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 md:hidden"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              {mobileNavOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="4" y1="7" x2="20" y2="7" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="17" x2="20" y2="17" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileNavOpen && (
        <nav
          id={ANCHORS.mobileNavDrawer}
          aria-label="Mobile navigation"
          className="border-t border-slate-800 bg-slate-950/95 px-3 py-2 md:hidden"
        >
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => navigate("dashboard")}
              aria-pressed={activeView === "dashboard"}
              className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                activeView === "dashboard"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-200 hover:bg-slate-800"
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => navigate("tags")}
              aria-pressed={activeView === "tags"}
              className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                activeView === "tags"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-200 hover:bg-slate-800"
              }`}
            >
              Tag Manager
            </button>
            <button
              type="button"
              onClick={() => navigate("health")}
              aria-pressed={activeView === "health"}
              className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                activeView === "health"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-200 hover:bg-slate-800"
              }`}
            >
              System Health
            </button>
            <button
              type="button"
              onClick={() => navigate("settings")}
              aria-pressed={activeView === "settings"}
              className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                activeView === "settings"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-200 hover:bg-slate-800"
              }`}
            >
              G-Sync &amp; Configuration
            </button>
          </div>
        </nav>
      )}
    </header>
  );
}
