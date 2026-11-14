import { useState } from "react";
import type { RuntimeDiagnostics, TelemetryRun } from "../domain/models";
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
      className="min-w-0 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:space-y-6 sm:p-5"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">System Health</h1>
          <p className="text-xs text-slate-400">
            Batch execution telemetry &amp; runtime diagnostic context
          </p>
        </div>
        <button
          type="button"
          onClick={onRunCheck}
          disabled={isChecking}
          aria-busy={isChecking}
          className="min-h-11 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 sm:min-h-9"
        >
          {isChecking ? "Running Check..." : "Run Batch Check Now"}
        </button>
      </div>

      {diagnostics && (
        <div className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs sm:p-4 md:grid-cols-2">
          <div>
            <span className="text-slate-400">App Version:</span>{" "}
            <span className="font-mono text-emerald-300">
              v{diagnostics.app_version}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Storage Adapter:</span>{" "}
            <span className="font-mono text-slate-200">
              {diagnostics.storage_adapter}
            </span>
          </div>
          <div className="md:col-span-2">
            <span className="text-slate-400">Python Executable:</span>{" "}
            <span className="font-mono break-all text-slate-200">
              {diagnostics.python_executable}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Python Version:</span>{" "}
            <span className="font-mono text-slate-200">
              {diagnostics.python_version}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Platform:</span>{" "}
            <span className="font-mono text-slate-200">{diagnostics.platform}</span>
          </div>
          <div className="md:col-span-2">
            <span className="text-slate-400">Workspace:</span>{" "}
            <span className="font-mono break-all text-slate-200">
              {diagnostics.workspace_dir}
            </span>
          </div>
        </div>
      )}

      {/* Mobile-first telemetry cards (< 768px) */}
      <div className="min-w-0 space-y-2.5 md:hidden">
        {telemetryLogs.map((run) => (
          <article
            key={run.run_id}
            className="min-w-0 space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate font-mono font-semibold text-slate-200">
                {run.run_id}
              </span>
              <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300">
                {run.status}
              </span>
            </div>
            <div className="text-slate-300">{run.breakdown}</div>
            <div className="flex items-center justify-between text-slate-400">
              <span>{run.started_at}</span>
              <span className="font-mono">{run.duration_ms}ms</span>
            </div>
            <button
              type="button"
              onClick={() => setSelectedRun(run)}
              className="min-h-11 w-full rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 sm:min-h-9"
            >
              Inspect JSON Log
            </button>
          </article>
        ))}
      </div>

      <div
        data-scroll-container="true"
        className="hidden overflow-x-auto md:block"
      >
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-800 text-slate-400">
            <tr>
              <th className="px-3 py-2">Run ID</th>
              <th className="px-3 py-2">Timestamp</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Checked</th>
              <th className="px-3 py-2">Breakdown</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2 text-right">Inspect</th>
            </tr>
          </thead>
          <tbody>
            {telemetryLogs.map((run) => (
              <tr key={run.run_id} className="border-t border-slate-800/80">
                <td className="px-3 py-2 font-mono text-slate-200">{run.run_id}</td>
                <td className="px-3 py-2 text-slate-400">{run.started_at}</td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] text-emerald-300">
                    {run.status}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono">{run.items_checked}</td>
                <td className="px-3 py-2 text-slate-300">{run.breakdown}</td>
                <td className="px-3 py-2 font-mono text-slate-400">
                  {run.duration_ms}ms
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setSelectedRun(run)}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                  >
                    JSON Log
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedRun && (
        <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-slate-200">
              Telemetry JSON: {selectedRun.run_id}
            </span>
            <button
              type="button"
              onClick={() => setSelectedRun(null)}
              className="text-slate-400 hover:text-slate-200"
            >
              Close
            </button>
          </div>
          <pre className="overflow-x-auto font-mono text-[11px] text-emerald-300">
            {JSON.stringify(selectedRun, null, 2)}
          </pre>
        </div>
      )}
    </section>
  );
}

