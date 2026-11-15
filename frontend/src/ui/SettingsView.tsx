import { useState } from "react";
import type { ConfigEntry } from "../domain/models";
import { ANCHORS } from "../shared/anchors";

interface SettingsViewProps {
  config: ConfigEntry[];
  onSaveConfig: (entries: ConfigEntry[]) => Promise<void>;
  onBootstrapSheets: () => Promise<string[]>;
}

export function SettingsView({
  config,
  onSaveConfig,
  onBootstrapSheets,
}: SettingsViewProps) {
  const byKey = new Map(config.map((c) => [c.key, c.value]));
  const [spreadsheetId, setSpreadsheetId] = useState(
    byKey.get("spreadsheet_id") ?? "",
  );
  const [recipient, setRecipient] = useState(
    byKey.get("gmail_alert_recipient") ?? "",
  );
  const [intervalHours, setIntervalHours] = useState(
    byKey.get("poll_interval_hours") ?? "6",
  );
  const [statusMessage, setStatusMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveConfig([
      {
        key: "spreadsheet_id",
        value: spreadsheetId.trim(),
        description: "Google Sheets Workbook ID",
      },
      {
        key: "gmail_alert_recipient",
        value: recipient.trim(),
        description: "Recipient for target_price discount digests",
      },
      {
        key: "poll_interval_hours",
        value: intervalHours.trim(),
        description: "Cloud Scheduler polling cadence in hours",
      },
    ]);
    setStatusMessage("Configuration saved.");
  };

  const handleBootstrap = async () => {
    const tabs = await onBootstrapSheets();
    setStatusMessage(
      tabs.length > 0
        ? `Initialized tabs: ${tabs.join(", ")}`
        : "All 7 workbook tabs are already initialized.",
    );
  };

  const cadenceOptions: ReadonlyArray<{ value: string; label: string }> = [
    { value: "1", label: "Every 1h" },
    { value: "6", label: "Every 6h" },
    { value: "12", label: "Every 12h" },
    { value: "24", label: "Daily" },
  ];

  return (
    <section
      id={ANCHORS.viewSettings}
      aria-label="G-Sync and Configuration"
      className="mx-auto min-w-0 max-w-3xl space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6"
    >
      <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-950">
            G-Sync &amp; Configuration
          </h1>
            <p className="mt-0.5 text-xs text-zinc-500">
              Configure Google Sheets workbook, Gmail alerts, and polling cadence
            </p>
          </div>

              <form onSubmit={handleSubmit} className="min-w-0 space-y-5 text-xs">
                <div className="min-w-0 divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
                  <div className="grid min-w-0 grid-cols-1 gap-2 p-4 sm:grid-cols-[190px_1fr] sm:items-center sm:gap-4">
                    <label
                      htmlFor="cfg-spreadsheet-id"
                      className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Google Spreadsheet ID
                    </label>
                    <input
                      id="cfg-spreadsheet-id"
                      type="text"
                      value={spreadsheetId}
                      onChange={(e) => setSpreadsheetId(e.target.value)}
                      placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                      className="min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 font-mono text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:outline-none sm:min-h-9"
                    />
                  </div>

                  <div className="grid min-w-0 grid-cols-1 gap-2 p-4 sm:grid-cols-[190px_1fr] sm:items-center sm:gap-4">
                    <label
                      htmlFor="cfg-gmail-recipient"
                      className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Gmail Alert Recipient
                    </label>
                    <input
                      id="cfg-gmail-recipient"
                      type="email"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      placeholder="you@gmail.com"
                      className="min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:outline-none sm:min-h-9"
                    />
                  </div>

                  <div className="grid min-w-0 grid-cols-1 gap-2 p-4 sm:grid-cols-[190px_1fr] sm:items-start sm:gap-4">
                    <label
                      htmlFor="cfg-poll-interval"
                      className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Polling Interval (Hours)
                    </label>
                    <div className="min-w-0 space-y-2.5">
                      <div
                        role="group"
                        aria-label="Polling cadence presets"
                        className="flex flex-wrap gap-1.5 rounded-lg bg-gray-100 p-1"
                      >
                        {cadenceOptions.map((option) => {
                          const isActive = intervalHours === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={isActive}
                              onClick={() => setIntervalHours(option.value)}
                              className={`min-h-11 flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:min-h-8 ${isActive
                                  ? "bg-white text-zinc-950 shadow-xs"
                                  : "text-zinc-600 hover:text-zinc-950"
                                }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <select
                        id="cfg-poll-interval"
                        value={intervalHours}
                        onChange={(e) => setIntervalHours(e.target.value)}
                        className="min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-xs text-zinc-950 focus:border-zinc-950 focus:bg-white focus:outline-none sm:min-h-9"
                      >
                        <option value="1">Every 1 hour</option>
                        <option value="4">Every 4 hours</option>
                        <option value="6">Every 6 hours</option>
                        <option value="8">Every 8 hours</option>
                        <option value="12">Every 12 hours</option>
                        <option value="24">Daily (Every 24 hours)</option>
                      </select>
                    </div>
                  </div>
                </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => void handleBootstrap()}
                      className="min-h-11 rounded-lg border border-gray-300 bg-white px-4 py-2 font-medium text-zinc-900 hover:bg-gray-50 sm:min-h-9"
                    >
                      Initialize 7-Tab Schema
                    </button>
                    <button
                      type="submit"
                      className="min-h-11 rounded-lg bg-zinc-950 px-5 py-2 font-semibold text-white hover:bg-zinc-800 sm:min-h-9"
                    >
                      Save Configuration
                    </button>
                  </div>

                  {statusMessage && (
                      <p
                        role="status"
                        className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 font-medium text-zinc-800"
                      >
                        {statusMessage}
                      </p>
        )}
                    </form>
    </section>
                );
}

