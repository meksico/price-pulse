import { useEffect, useRef, useState } from "react";
import { ANCHORS } from "../shared/anchors";
import { useI18n } from "../shared/i18n";
import { buildRouteUrl, type AppRoute } from "../shared/routes";
import { useBottomSheetSwipeDismiss } from "../shared/useBottomSheetSwipeDismiss";

export type RunCheckItemState = "pending" | "success" | "error";

export type RunCheckPhase =
  | "scraping"
  | "gemini_fallback"
  | "saving"
  | "notifying"
  | "complete"
  | "error";

export interface RunCheckTrackedEntry {
  item_id: string;
  name: string;
  domain: string;
  url: string;
  state: RunCheckItemState;
  error_code: string | null;
}

export interface RunCheckProgressState {
  visible: boolean;
  running: boolean;
  expanded: boolean;
  phase: RunCheckPhase;
  startedAtMs: number;
  items: RunCheckTrackedEntry[];
  errorMessage?: string | null;
}

interface RunCheckProgressProps {
  progress: RunCheckProgressState;
  currentRoute: AppRoute;
  onToggleExpand: (expanded: boolean) => void;
  onDismiss: () => void;
  onOpenItem: (itemId: string) => void;
}

function getPhaseLabelKey(phase: RunCheckPhase) {
  switch (phase) {
    case "scraping":
      return "runCheck.phaseScraping" as const;
    case "gemini_fallback":
      return "runCheck.phaseGemini" as const;
    case "saving":
      return "runCheck.phaseSaving" as const;
    case "notifying":
      return "runCheck.phaseNotifying" as const;
    case "complete":
      return "runCheck.phaseComplete" as const;
    case "error":
      return "runCheck.phaseError" as const;
  }
}

export function RunCheckProgress({
  progress,
  currentRoute,
  onToggleExpand,
  onDismiss,
  onOpenItem,
}: RunCheckProgressProps) {
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const stickyAutoScrollRef = useRef(true);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    if (!progress.visible || !progress.running) return;
    setElapsedSec(
      Math.max(0, Math.floor((Date.now() - progress.startedAtMs) / 1000)),
    );
    const timer = window.setInterval(() => {
      setElapsedSec(
        Math.max(0, Math.floor((Date.now() - progress.startedAtMs) / 1000)),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [progress.visible, progress.running, progress.startedAtMs]);

  useBottomSheetSwipeDismiss({
    sheetRef,
    handleRef,
    isOpen: progress.visible && progress.expanded,
    onClose: () => onToggleExpand(false),
  });

  useEffect(() => {
    if (!progress.visible || !progress.expanded) return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onToggleExpand(false);
      }
    };
    const handlePointerDown = (ev: MouseEvent) => {
      if (
        sheetRef.current &&
        ev.target instanceof Node &&
        !sheetRef.current.contains(ev.target)
      ) {
        onToggleExpand(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [progress.visible, progress.expanded, onToggleExpand]);

  useEffect(() => {
    if (!progress.expanded || !terminalRef.current) return;
    if (stickyAutoScrollRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [progress.expanded, progress.items, progress.phase]);

  if (!progress.visible) return null;

  const total = progress.items.length;
  const succeeded = progress.items.filter((it) => it.state === "success").length;
  const failedItems = progress.items.filter((it) => it.state === "error");
  const completed = succeeded + failedItems.length;
  const phaseLabel = t(getPhaseLabelKey(progress.phase));

  const renderBulletBar = (compact: boolean) => (
    <div
      role="group"
      aria-label={t("runCheck.bulletsAriaLabel")}
      className={`flex flex-wrap items-center ${compact ? "gap-1" : "gap-1.5"}`}
    >
      {progress.items.map((item) => {
        const colorClass =
          item.state === "success"
            ? "bg-emerald-500"
            : item.state === "error"
              ? "bg-red-500"
              : "bg-zinc-300";
        return (
          <span
            key={item.item_id}
            title={`${item.name} (${item.domain})`}
            data-bullet-state={item.state}
            className={`inline-block shrink-0 rounded-full transition-colors duration-150 ${
              compact ? "h-2 w-2" : "h-2.5 w-2.5"
            } ${colorClass}`}
          />
        );
      })}
    </div>
  );

  if (!progress.expanded) {
    return (
      <section
        id={ANCHORS.runCheckProgress}
        aria-label={t("runCheck.title")}
        className="fixed right-3 bottom-16 z-[55] w-[calc(100vw-1.5rem)] max-w-sm rounded-xl border border-gray-200 bg-white p-3 text-xs shadow-lg sm:right-5 sm:bottom-5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {progress.running ? (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600"
              />
            ) : (
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  progress.phase === "error"
                    ? "bg-red-500"
                    : failedItems.length > 0
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                }`}
              />
            )}
            <span className="truncate font-semibold text-zinc-950">
              {phaseLabel}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="tabular-nums font-mono text-[11px] text-zinc-600">
              {t("runCheck.progressCount", { completed, total })}
            </span>
            <button
              type="button"
              onClick={() => onToggleExpand(true)}
              aria-expanded={false}
              className="rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-800"
            >
              {t("runCheck.expandDetails")}
            </button>
            {!progress.running && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t("runCheck.closeLabel")}
                className="rounded-md px-1.5 py-0.5 text-zinc-400 hover:bg-gray-100 hover:text-zinc-700"
              >
                ×
              </button>
            )}
          </div>
        </div>
        {total > 0 && <div className="mt-2">{renderBulletBar(true)}</div>}
      </section>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-4">
      <div
        ref={sheetRef}
        id={ANCHORS.modalRunCheckDetails}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-run-check-details__title"
        className="flex max-h-[88dvh] w-full flex-col rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:max-w-2xl sm:rounded-2xl"
      >
        <div
          ref={handleRef}
          className="flex flex-col border-b border-gray-100 px-4 pt-2 pb-3 sm:px-5 sm:pt-4"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-2 h-1 w-9 rounded-full bg-gray-300 sm:hidden"
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {progress.running ? (
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    progress.phase === "error"
                      ? "bg-red-500"
                      : failedItems.length > 0
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                  }`}
                />
              )}
              <h2
                id="modal-run-check-details__title"
                className="truncate text-sm font-semibold text-zinc-950"
              >
                {t("runCheck.title")}
              </h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                {phaseLabel}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="tabular-nums font-mono text-xs text-zinc-500">
                {t("runCheck.progressCount", { completed, total })} · {elapsedSec}s
              </span>
              <button
                type="button"
                onClick={() => onToggleExpand(false)}
                aria-expanded={true}
                className="min-h-9 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-gray-50"
              >
                {t("runCheck.collapseDetails")}
              </button>
              {!progress.running && (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label={t("runCheck.closeLabel")}
                  className="min-h-9 min-w-9 rounded-lg text-zinc-400 hover:bg-gray-100 hover:text-zinc-700"
                >
                  ×
                </button>
              )}
            </div>
          </div>
          {total > 0 && <div className="mt-3">{renderBulletBar(false)}</div>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          <div
            ref={terminalRef}
            onScroll={() => {
              const el = terminalRef.current;
              if (!el) return;
              const distFromBottom =
                el.scrollHeight - el.scrollTop - el.clientHeight;
              stickyAutoScrollRef.current = distFromBottom < 32;
            }}
            className="max-h-[45dvh] overflow-y-auto rounded-xl bg-zinc-950 p-3.5 font-mono text-xs leading-relaxed text-zinc-100"
          >
            {progress.items.map((item, idx) => {
              const bulletColor =
                item.state === "success"
                  ? "text-emerald-400"
                  : item.state === "error"
                    ? "text-red-400"
                    : "text-zinc-500";
              return (
                <div
                  key={item.item_id}
                  data-terminal-item={item.item_id}
                  className="break-words py-0.5"
                >
                  <span className="text-zinc-500">{idx + 1}. </span>
                  <span className="text-zinc-100">{item.name}</span>
                  {item.domain && (
                    <span className="text-zinc-400"> ({item.domain})</span>
                  )}
                  <span className="text-zinc-500"> - </span>
                  <span
                    aria-label={
                      item.state === "pending"
                        ? t("runCheck.pendingStatus")
                        : item.state
                    }
                    className={`inline-block font-bold ${bulletColor}`}
                  >
                    ●
                  </span>
                  {item.state === "error" && item.error_code && (
                    <span className="ml-1.5 text-red-300">
                      {item.error_code}
                    </span>
                  )}
                </div>
              );
            })}

            <div className="mt-3 border-t border-zinc-800 pt-2.5 font-semibold text-zinc-100">
              {t("runCheck.summaryLabel", { succeeded, total })}
            </div>

            {progress.errorMessage && (
              <div className="mt-2 text-red-300">{progress.errorMessage}</div>
            )}

            {failedItems.length > 0 && (
              <div className="mt-3 border-t border-zinc-800 pt-2.5">
                <div className="mb-1.5 font-semibold text-amber-300">
                  {t("runCheck.failedUrlsHeading")}
                </div>
                <ol className="space-y-1">
                  {failedItems.map((item, idx) => {
                    const href = buildRouteUrl({
                      ...currentRoute,
                      itemId: item.item_id,
                    });
                    return (
                      <li key={item.item_id} className="break-words">
                        <span className="text-zinc-500">{idx + 1}. </span>
                        <a
                          href={href}
                          onClick={(ev) => {
                            ev.preventDefault();
                            onToggleExpand(false);
                            onOpenItem(item.item_id);
                          }}
                          className="text-sky-400 underline hover:text-sky-300"
                        >
                          {item.name}
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
