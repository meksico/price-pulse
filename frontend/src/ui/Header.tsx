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
  onSignOut?: () => void;
}

const DESKTOP_TABS: Array<{ id: AppView; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "tags", label: "Tag Manager" },
];

export function Header({
  activeView,
  onSelectView,
  activeItemCount,
  tagCount,
  isChecking,
  onRunCheck,
  onOpenAddModal,
  spreadsheetId,
  onSignOut,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navigate = (view: AppView) => {
    setMenuOpen(false);
    setMobileNavOpen(false);
    onSelectView(view);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl min-w-0 items-center justify-between gap-1.5 px-2 sm:gap-2 sm:px-4">
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => navigate("dashboard")}
            className="min-h-11 shrink-0 whitespace-nowrap text-left text-sm font-bold tracking-tight text-zinc-950 sm:min-h-9 sm:text-lg"
          >
            PricePulse
          </button>
        </div>

        <nav
          aria-label="Primary navigation"
          className="hidden h-full items-center gap-3 md:flex lg:gap-6"
        >
          {DESKTOP_TABS.map((tab) => {
            const isActive = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigate(tab.id)}
                aria-pressed={isActive}
                className={`relative inline-flex h-full min-h-11 min-w-0 items-center whitespace-nowrap text-[13px] transition-colors sm:min-h-9 ${
                  isActive
                    ? "font-semibold text-zinc-950"
                    : "font-medium text-zinc-500 hover:text-zinc-950"
                }`}
              >
                {tab.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute right-0 bottom-0 left-0 h-[2px] rounded-full bg-zinc-950"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={onOpenAddModal}
            aria-label="+ Track New URL"
            className="min-h-11 whitespace-nowrap rounded-lg bg-zinc-950 px-1.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-zinc-800 sm:min-h-9 sm:px-3 sm:text-xs lg:px-3.5"
          >
            <span className="lg:hidden">+ Track</span>
            <span className="hidden lg:inline">+ Track New URL</span>
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
              className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-gray-200 bg-gray-100 px-1.5 py-1 text-xs text-zinc-950 transition-colors hover:bg-gray-200 sm:min-h-9 lg:min-w-0 lg:px-2.5"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-zinc-950">
                PP
              </span>
              <span className="hidden font-medium lg:inline">Owner</span>
            </button>

                {menuOpen && (
                  <div
                    id={ANCHORS.userDropdownMenu}
                    role="menu"
                    aria-label="Account and system navigation"
                    className="absolute right-0 mt-2 w-60 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-gray-200 bg-white py-2 text-xs text-zinc-900 shadow-xl"
                  >
                        <div className="border-b border-gray-100 px-3 py-2 text-zinc-500">
                          <div className="tabular-nums font-semibold text-zinc-950">
                            {activeItemCount} Positions &amp; {tagCount} Tags Synced
                          </div>
                            <div className="tabular-nums mt-0.5 text-[11px] text-zinc-400">
                              v{APP_VERSION}
                            </div>
                          </div>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => navigate("health")}
                            className="block min-h-11 w-full px-3 py-2 text-left font-medium text-zinc-800 hover:bg-gray-50 sm:min-h-9"
                          >
                            System Health (Logs review)
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => navigate("tags")}
                            className="block min-h-11 w-full px-3 py-2 text-left font-medium text-zinc-800 hover:bg-gray-50 sm:min-h-9"
                          >
                            Tag Manager
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => navigate("settings")}
                            className="block min-h-11 w-full px-3 py-2 text-left font-medium text-zinc-800 hover:bg-gray-50 sm:min-h-9"
                          >
                            G-Sync &amp; Configuration
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            disabled={isChecking}
                            aria-busy={isChecking}
                            onClick={() => {
                              setMenuOpen(false);
                              onRunCheck();
                            }}
                            className="tabular-nums block min-h-11 w-full px-3 py-2 text-left font-medium text-zinc-800 hover:bg-gray-50 disabled:opacity-40 sm:min-h-9"
                          >
                            {isChecking ? "Checking..." : `Run Check (${activeItemCount} Items)`}
                          </button>
                          {spreadsheetId && (
                            <a
                              role="menuitem"
                              href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="block min-h-11 w-full px-3 py-2 text-left font-medium text-blue-600 hover:bg-gray-50 sm:min-h-9"
                            >
                              Open Google Sheet
                            </a>
                          )}
                          {onSignOut && (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMenuOpen(false);
                                onSignOut();
                              }}
                              className="mt-1 block min-h-11 w-full border-t border-gray-100 px-3 py-2 text-left font-medium text-red-600 hover:bg-red-50 sm:min-h-9"
                            >
                              Sign out
                            </button>
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
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-zinc-900 hover:bg-gray-50 md:hidden"
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
          className="border-t border-gray-200 bg-white px-3 py-2 md:hidden"
        >
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => navigate("dashboard")}
              aria-pressed={activeView === "dashboard"}
              className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                activeView === "dashboard"
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-900 hover:bg-gray-100"
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => navigate("tags")}
              aria-pressed={activeView === "tags"}
              className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                activeView === "tags"
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-900 hover:bg-gray-100"
              }`}
            >
              Tag Manager
            </button>
            <button
              type="button"
              onClick={() => navigate("health")}
              aria-pressed={activeView === "health"}
              className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                activeView === "health"
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-900 hover:bg-gray-100"
              }`}
            >
              System Health
            </button>
            <button
              type="button"
              onClick={() => navigate("settings")}
              aria-pressed={activeView === "settings"}
              className={`min-h-11 w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                activeView === "settings"
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-900 hover:bg-gray-100"
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

              interface MobileBottomNavProps {
                activeView: AppView;
              anomalyCount: number;
  onSelectView: (view: AppView) => void;
  onOpenAddModal: () => void;
}

              export function MobileBottomNav({
                activeView,
                anomalyCount,
                onSelectView,
                onOpenAddModal,
}: MobileBottomNavProps) {
  return (
              <nav
                id={ANCHORS.mobileBottomNav}
                aria-label="Bottom Navigation"
                className="sticky bottom-0 z-30 flex h-14 items-center justify-around border-t border-gray-200 bg-white px-2 md:hidden"
              >
                <button
                  type="button"
                  aria-label="Dashboard"
                  aria-current={activeView === "dashboard" ? "page" : undefined}
                  onClick={() => onSelectView("dashboard")}
                  className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-gray-50"
                >
                  {activeView === "dashboard" ? (
                    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="#09090B">
                      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5.5v-6.5h-5V21H4a1 1 0 01-1-1v-9.5z" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#52525B"
                      strokeWidth="1.75"
                    >
                      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5.5v-6.5h-5V21H4a1 1 0 01-1-1v-9.5z" />
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  aria-label="Tag Manager"
                  aria-current={activeView === "tags" ? "page" : undefined}
                  onClick={() => onSelectView("tags")}
                  className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-gray-50"
                >
                  {activeView === "tags" ? (
                    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="#09090B">
                      <path d="M3 7a2 2 0 012-2h5.586a2 2 0 011.414.586l8.414 8.414a2 2 0 010 2.828l-4.586 4.586a2 2 0 01-2.828 0L4.586 13A2 2 0 014 11.586V7z" />
                      <circle cx="8" cy="9" r="1.25" fill="#FFFFFF" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#52525B"
                      strokeWidth="1.75"
                    >
                      <path d="M3 7a2 2 0 012-2h5.586a2 2 0 011.414.586l8.414 8.414a2 2 0 010 2.828l-4.586 4.586a2 2 0 01-2.828 0L4.586 13A2 2 0 014 11.586V7z" />
                      <circle cx="8" cy="9" r="1" fill="#52525B" />
                    </svg>
                  )}
                </button>

                <button
                  type="button"
                  aria-label="Track New URL"
                  onClick={onOpenAddModal}
                  className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-gray-50"
                >
                  <svg
                    aria-hidden="true"
                    className="h-5 w-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#09090B"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <path d="M12 8v8M8 12h8" />
                  </svg>
                </button>

                <button
                  type="button"
                  aria-label="System Health"
                  aria-current={activeView === "health" ? "page" : undefined}
                  onClick={() => onSelectView("health")}
                  className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-gray-50"
                >
                  {activeView === "health" ? (
                    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="#09090B">
                      <path d="M12 2a7 7 0 00-7 7v4l-2 3v1h18v-1l-2-3V9a7 7 0 00-7-7zm0 20a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0012 22z" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#52525B"
                      strokeWidth="1.75"
                    >
                      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9zm-4.27 13a2 2 0 01-3.46 0" />
                    </svg>
                  )}
                  {anomalyCount > 0 && (
                    <span className="tabular-nums absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                      {anomalyCount}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  aria-label="G-Sync Settings"
                  aria-current={activeView === "settings" ? "page" : undefined}
                  onClick={() => onSelectView("settings")}
                  className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-gray-50"
                >
                  {activeView === "settings" ? (
                    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="#09090B">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#52525B"
                      strokeWidth="1.75"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                    </svg>
                  )}
                </button>
              </nav>
              );
}
