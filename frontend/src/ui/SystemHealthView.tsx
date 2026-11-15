import { useEffect, useRef, useState } from "react";
import {
  APP_VERSION,
  type RuntimeDiagnostics,
  type TelemetryRun,
} from "../domain/models";
import { ANCHORS } from "../shared/anchors";
import type { PushToastFn } from "./ToastViewport";

interface SystemHealthViewProps {
  telemetryLogs: TelemetryRun[];
  diagnostics: RuntimeDiagnostics | null;
  onNotify?: PushToastFn;
}

export function SystemHealthView({
  telemetryLogs,
  diagnostics,
  onNotify,
}: SystemHealthViewProps) {
  const [selectedRun, setSelectedRun] = useState<TelemetryRun | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCopied(false);
    if (!selectedRun) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setSelectedRun(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedRun(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedRun]);

  const formattedJson = selectedRun
    ? JSON.stringify(
        diagnostics
          ? {
              ...selectedRun,
              runtime_diagnostics: {
                ...diagnostics,
                app_version: APP_VERSION,
              },
            }
          : selectedRun,
        null,
        2,
      )
    : "";

  const handleCopyJson = async () => {
    if (!formattedJson) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(formattedJson);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      setCopied(true);
      onNotify?.(
        "success",
        "Copied telemetry JSON",
        "Run log copied to your clipboard.",
      );
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = formattedJson;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        onNotify?.(
          "success",
          "Copied telemetry JSON",
          "Run log copied to your clipboard.",
        );
      } catch (err) {
        onNotify?.(
          "error",
          "Copy failed",
          err instanceof Error
            ? err.message
            : "Could not copy telemetry JSON to clipboard.",
        );
      }
    }
  };

  return (
    <section
      id={ANCHORS.viewHealth}
      aria-label="System Health and Diagnostics"
      className="mx-auto min-w-0 max-w-5xl space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6"
    >
      <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-[22px] font-bold tracking-tight text-zinc-950">
              System Health
            </h1>
            <span className="tabular-nums font-mono text-xs font-semibold text-zinc-950">
              v{APP_VERSION}
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Batch execution telemetry &amp; runtime diagnostic context
          </p>
      </div>

              {/* Mobile-first telemetry cards (< 768px) */}
              <div className="min-w-0 space-y-2.5 md:hidden">
                      {telemetryLogs.map((run) => {
                        const isAnomaly = run.status !== "SUCCESS";
                        return (
                          <article
                            key={run.run_id}
                            className="min-w-0 space-y-2 rounded-xl border border-gray-200 bg-white p-3.5 text-xs"
                          >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${isAnomaly ? "bg-red-500" : "bg-transparent"
                        }`}
                    />
                    <span className="truncate font-mono font-semibold text-zinc-950">
                      {run.run_id}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${isAnomaly
                        ? "bg-red-50 text-red-700"
                        : "bg-gray-100 text-zinc-700"
                      }`}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="text-zinc-600">{run.breakdown}</div>
                <div className="tabular-nums flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{run.started_at}</span>
                  <span>{run.duration_ms}ms</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRun(run)}
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-950 hover:bg-gray-50 sm:min-h-9"
                >
                  Inspect JSON Log
                </button>
              </article>
              );
        })}
          </div>

          {/* Desktop telemetry table (>= 768px) */}
          <div
            data-scroll-container="true"
            className="hidden overflow-x-auto rounded-xl border border-gray-200 md:block"
          >
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                        <th className="px-4 py-2.5">Run ID</th>
                        <th className="px-3 py-2.5">Timestamp</th>
                        <th className="px-3 py-2.5">Status</th>
                        <th className="px-3 py-2.5 text-right">Checked</th>
                        <th className="px-3 py-2.5">Breakdown</th>
                        <th className="px-3 py-2.5 text-right">Duration</th>
                        <th className="px-4 py-2.5 text-right">Inspect</th>
                      </tr>
                    </thead>
                      <tbody className="divide-y divide-gray-100">
                        {telemetryLogs.map((run) => {
                          const isAnomaly = run.status !== "SUCCESS";
                          return (
                            <tr key={run.run_id} className="hover:bg-gray-50/70">
                              <td className="px-4 py-3 font-mono font-semibold text-zinc-950">
                                <span className="inline-flex items-center gap-2.5">
                                  <span
                                    aria-hidden="true"
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${isAnomaly ? "bg-red-500" : "bg-transparent"
                                      }`}
                                  />
                                  {run.run_id}
                                </span>
                              </td>
                              <td className="tabular-nums px-3 py-3 text-zinc-500">
                                {run.started_at}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${isAnomaly
                                      ? "bg-red-50 text-red-700"
                                      : "bg-gray-100 text-zinc-700"
                                    }`}
                                >
                                  {run.status}
                                </span>
                              </td>
                              <td className="tabular-nums px-3 py-3 text-right text-zinc-700">
                                {run.items_checked}
                              </td>
                              <td className="px-3 py-3 text-zinc-600">{run.breakdown}</td>
                              <td className="tabular-nums px-3 py-3 text-right text-zinc-500">
                                {run.duration_ms}ms
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => setSelectedRun(run)}
                                  className="h-8 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-zinc-950 hover:bg-gray-50"
                                >
                                  JSON Log
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                  </table>
                </div>

      {selectedRun && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
          <div
            id={ANCHORS.modalTelemetryJson}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="telemetry-json-modal-title"
            className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-[20px] border border-gray-200 bg-white p-4 text-xs text-zinc-950 shadow-xl sm:rounded-2xl sm:p-6"
          >
            <div
              aria-hidden="true"
              className="mx-auto mb-3 h-1 w-9 rounded-full bg-zinc-300 sm:hidden"
            />
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2
                id="telemetry-json-modal-title"
                className="font-mono text-sm font-semibold text-zinc-950"
              >
                Telemetry JSON: {selectedRun.run_id}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyJson()}
                  className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-950 transition-colors hover:bg-gray-50 sm:min-h-8"
                >
                  {copied ? "Copied!" : "Copy JSON"}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRun(null)}
                  className="min-h-11 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-gray-200 hover:text-zinc-950 sm:min-h-8"
                >
                  Close
                </button>
              </div>
            </div>
            <pre className="max-h-[68dvh] overflow-auto rounded-xl border border-gray-200 bg-gray-50 p-3.5 font-mono text-[11px] text-zinc-800">
              {formattedJson}
            </pre>
          </div>
        </div>
      )}
                  </section>
                );
}
