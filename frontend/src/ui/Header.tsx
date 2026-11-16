import { useEffect, useRef, useState } from "react";
import { APP_VERSION } from "../domain/models";
import { ANCHORS } from "../shared/anchors";
import { deriveUserInitials, deriveUserNick } from "../shared/auth";
import { BrandMark } from "./BrandLogo";

export type AppView = "dashboard" | "tags" | "health";

interface HeaderProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  activeItemCount: number;
  tagCount: number;
  isChecking: boolean;
  onRunCheck: () => void;
  onOpenAddModal: () => void;
  spreadsheetId: string;
  userName?: string;
  userEmail?: string;
  userAvatarUrl?: string;
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
  userName = "",
  userEmail = "",
  userAvatarUrl = "",
  onSignOut,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const userMenuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        userMenuContainerRef.current &&
        !userMenuContainerRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const showAvatarImage = Boolean(
    userAvatarUrl && failedAvatarUrl !== userAvatarUrl,
  );
  const userInitials = deriveUserInitials(userName, userEmail);
  const userNick = deriveUserNick(userEmail, userName);

  const navigate = (view: AppView) => {
    setMenuOpen(false);
    onSelectView(view);
  };

  return (
    <header className="relative z-40 w-full border-b border-gray-200 bg-white/95 backdrop-blur md:sticky md:top-0">
      <div className="mx-auto flex h-14 w-full max-w-7xl min-w-0 items-center justify-between gap-1.5 px-2 sm:gap-2 sm:px-4">
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => navigate("dashboard")}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap text-left text-sm font-bold tracking-tight text-zinc-950 sm:min-h-9 sm:gap-2 sm:text-lg"
          >
            <BrandMark className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
            <span>PricePulse</span>
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
            className="hidden min-h-11 items-center justify-center whitespace-nowrap rounded-lg bg-zinc-950 px-1.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-zinc-800 sm:min-h-9 sm:px-3 sm:text-xs md:inline-flex lg:px-3.5"
          >
            <span className="lg:hidden">+ Track</span>
            <span className="hidden lg:inline">+ Track New URL</span>
          </button>

          <div ref={userMenuContainerRef} className="relative">
            <button
              type="button"
              aria-label="User account menu"
              aria-expanded={menuOpen}
              aria-controls={ANCHORS.userDropdownMenu}
              onClick={() => {
                setMenuOpen((prev) => !prev);
              }}
              className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-gray-200 bg-gray-100 px-1.5 py-1 text-xs text-zinc-950 transition-colors hover:bg-gray-200 sm:min-h-9 lg:min-w-0 lg:px-2.5"
            >
              {showAvatarImage ? (
                <img
                  src={userAvatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setFailedAvatarUrl(userAvatarUrl ?? null)}
                  className="h-6 w-6 shrink-0 rounded-full bg-white object-cover"
                />
              ) : (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold uppercase text-zinc-950">
                  {userInitials}
                </span>
              )}
              <span className="hidden max-w-[120px] truncate font-medium lg:inline">
                {userNick}
              </span>
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
        </div>
      </div>
    </header>
  );
}

interface MobileBottomNavProps {
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  onOpenAddModal: () => void;
}

export function MobileBottomNav({
  activeView,
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
        className={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border transition-colors ${
          activeView === "dashboard"
            ? "border-gray-300 bg-gray-100 hover:bg-gray-200/70"
            : "border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
        }`}
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
        className={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border transition-colors ${
          activeView === "tags"
            ? "border-gray-300 bg-gray-100 hover:bg-gray-200/70"
            : "border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100"
        }`}
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
        className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 transition-colors hover:border-gray-300 hover:bg-gray-100"
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
    </nav>
  );
}
