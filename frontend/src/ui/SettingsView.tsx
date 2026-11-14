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

  return (
    <section
      id={ANCHORS.viewSettings}
      aria-label="G-Sync and Configuration"
      className="min-w-0 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-5"
    >
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-slate-100">
          G-Sync &amp; Configuration
        </h1>
        <p className="text-xs text-slate-400">
          Configure Google Sheets workbook, Gmail alerts, and polling schedule
        </p>
      </div>

      <form onSubmit={handleSubmit} className="min-w-0 max-w-xl space-y-4 text-xs">
        <div>
          <label
            htmlFor="cfg-spreadsheet-id"
            className="mb-1 block font-medium text-slate-300"
          >
            Google Spreadsheet ID
          </label>
          <input
            id="cfg-spreadsheet-id"
            type="text"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
            className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
          />
        </div>
        <div>
          <label
            htmlFor="cfg-gmail-recipient"
            className="mb-1 block font-medium text-slate-300"
          >
            Gmail Alert Recipient
          </label>
          <input
            id="cfg-gmail-recipient"
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="you@gmail.com"
            className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
          />
        </div>
        <div>
          <label
            htmlFor="cfg-poll-interval"
            className="mb-1 block font-medium text-slate-300"
          >
            Polling Interval (Hours)
          </label>
          <select
            id="cfg-poll-interval"
            value={intervalHours}
            onChange={(e) => setIntervalHours(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
          >
            <option value="4">Every 4 hours</option>
            <option value="6">Every 6 hours</option>
            <option value="8">Every 8 hours</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400 sm:min-h-9"
          >
            Save Configuration
          </button>
          <button
            type="button"
            onClick={() => void handleBootstrap()}
            className="min-h-11 rounded-lg border border-slate-700 px-4 py-2 text-slate-200 hover:bg-slate-800 sm:min-h-9"
          >
            Initialize 7-Tab Schema
          </button>
        </div>

        {statusMessage && (
          <p role="status" className="text-emerald-300">
            {statusMessage}
          </p>
        )}
      </form>
    </section>
  );
}

