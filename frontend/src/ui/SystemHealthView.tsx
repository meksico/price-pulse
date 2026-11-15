import { useState } from "react";
import {
  APP_VERSION,
  type RuntimeDiagnostics,
  type TelemetryRun,
} from "../domain/models";
import { ANCHORS } from "../shared/anchors";

interface SystemHealthViewProps {
  telemetryLogs: TelemetryRun[];
  diagnostics: RuntimeDiagnostics | null;
  isChecking: boolean;
  onRunCheck: () => void;
}

export function SystemHealthView({
  telemetryLogs,
  diagnostics,
  isChecking,
  onRunCheck,
}: SystemHealthViewProps) {
  const [selectedRun, setSelectedRun] = useState<TelemetryRun | null>(null);

  return (
    <section
      id={ANCHORS.viewHealth}
      aria-label="System Health and Diagnostics"
      className="mx-auto min-w-0 max-w-5xl space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
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
        <button
          type="button"
          onClick={onRunCheck}
          disabled={isChecking}
          aria-busy={isChecking}
          className="min-h-11 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-40 sm:min-h-10"
        >
          {isChecking ? "Running Check..." : "Run Batch Check Now"}
        </button>
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
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-xs">
                      <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono font-semibold text-zinc-950">
                            Telemetry JSON: {selectedRun.run_id}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedRun(null)}
                            className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-gray-200 hover:text-zinc-950"
                          >
                            Close
                          </button>
                      </div>
                        <pre className="overflow-x-auto font-mono text-[11px] text-zinc-800">
                          {JSON.stringify(
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
                          )}
                        </pre>
                    </div>
      )}
                  </section>
                );
}
