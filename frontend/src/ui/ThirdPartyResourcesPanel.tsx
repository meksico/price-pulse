import { useMemo, useState } from "react";
import {
  FRONTEND_PACKAGES,
  type ResourceCategory,
  type ResourcesInventory,
  type ThirdPartyResource,
} from "../domain/models";
import { ANCHORS } from "../shared/anchors";
import { useI18n } from "../shared/i18n";

interface ThirdPartyResourcesPanelProps {
  inventory: ResourcesInventory | null;
  loading: boolean;
  probing: boolean;
  onRefresh: () => void;
  onProbe: () => void;
}

type FilterOption = "all" | ResourceCategory;

function formatQuotaText(res: ThirdPartyResource): string {
  if (res.quota_used !== null && res.quota_limit !== null) {
    return `${res.quota_used.toLocaleString()} / ${res.quota_limit.toLocaleString()} ${res.quota_unit}`;
  }
  if (res.quota_limit !== null) {
    return `Limit: ${res.quota_limit.toLocaleString()} ${res.quota_unit}`;
  }
  return "—";
}

function summarizeDetails(res: ThirdPartyResource): string[] {
  const lines: string[] = [];
  const d = res.details;
  if (res.resource_id === "webshare_proxies") {
    const count = Number(d.proxy_pool_count ?? 0);
    const limit = Number(d.proxy_limit ?? 10);
    lines.push(`Pool: ${count}/${limit} proxies`);
    if (typeof d.requests_total === "number" && d.requests_total > 0) {
      lines.push(
        `Req: ${Number(d.requests_successful ?? 0)}/${d.requests_total} ok`,
      );
    }
    if (Array.isArray(d.proxy_hosts) && d.proxy_hosts.length > 0) {
      lines.push(`Hosts: ${(d.proxy_hosts as string[]).slice(0, 2).join(", ")}`);
    }
  } else if (res.resource_id === "gemini_grounding") {
    if (typeof d.model === "string") lines.push(`Model: ${d.model}`);
    if (typeof d.cooldown_hours === "number") {
      lines.push(`Cooldown: ${d.cooldown_hours}h`);
    }
  } else if (res.resource_id === "google_sheets") {
    if (typeof d.adapter === "string") lines.push(`Adapter: ${d.adapter}`);
    if (typeof d.spreadsheet_id_masked === "string" && d.spreadsheet_id_masked) {
      lines.push(`Sheet: ${d.spreadsheet_id_masked}`);
    }
    if (typeof d.spreadsheet_title === "string" && d.spreadsheet_title) {
      lines.push(`Title: ${d.spreadsheet_title}`);
    }
  } else if (res.resource_id === "gmail_api") {
    if (typeof d.alert_recipient === "string") {
      lines.push(`Recipient: ${d.alert_recipient}`);
    }
    if (typeof d.verified_sender === "string") {
      lines.push(`Sender: ${d.verified_sender}`);
    }
  } else if (res.resource_id === "google_oauth") {
    if (typeof d.auth_mode === "string") lines.push(`Auth: ${d.auth_mode}`);
    if (typeof d.client_id_masked === "string" && d.client_id_masked) {
      lines.push(`Client: ${d.client_id_masked}`);
    }
  } else if (res.resource_id === "playwright_chromium") {
    if (typeof d.playwright_version === "string") {
      lines.push(`v${d.playwright_version}`);
    }
    if (typeof d.timeout_ms === "number") {
      lines.push(`Timeout: ${Math.round(d.timeout_ms / 1000)}s`);
    }
  }
  return lines;
}

export function ThirdPartyResourcesPanel({
  inventory,
  loading,
  probing,
  onRefresh,
  onProbe,
}: ThirdPartyResourcesPanelProps) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<FilterOption>("all");

  const resources = useMemo(
    () => inventory?.resources ?? [],
    [inventory?.resources],
  );

  const filteredResources = useMemo(() => {
    if (filter === "all") return resources;
    return resources.filter((r) => r.category === filter);
  }, [filter, resources]);

  const activeCount = useMemo(
    () => resources.filter((r) => r.status === "operational").length,
    [resources],
  );

  const geminiRes = useMemo(
    () => resources.find((r) => r.resource_id === "gemini_grounding"),
    [resources],
  );

  const webshareRes = useMemo(
    () => resources.find((r) => r.resource_id === "webshare_proxies"),
    [resources],
  );

  const backendPkgs = useMemo(
    () => Object.entries(inventory?.backend_packages ?? {}),
    [inventory?.backend_packages],
  );
  const frontendPkgs = useMemo(() => Object.entries(FRONTEND_PACKAGES), []);

  const modeLabel = (mode: ThirdPartyResource["mode"]) => {
    if (mode === "live") return t("health.modeLive");
    if (mode === "configured") return t("health.modeConfigured");
    if (mode === "mock") return t("health.modeMock");
    return t("health.modeDisabled");
  };

  const statusLabel = (status: ThirdPartyResource["status"]) => {
    if (status === "operational") return t("health.statusOperational");
    if (status === "warning") return t("health.statusWarning");
    return t("health.statusDisabled");
  };

  const statusBadgeClass = (status: ThirdPartyResource["status"]) => {
    if (status === "operational") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    }
    if (status === "warning") {
      return "bg-amber-50 text-amber-800 border-amber-200";
    }
    return "bg-gray-100 text-zinc-600 border-gray-200";
  };

  const geminiPct =
    geminiRes?.quota_used !== null &&
    geminiRes?.quota_used !== undefined &&
    geminiRes?.quota_limit
      ? Math.min(100, Math.round((geminiRes.quota_used / geminiRes.quota_limit) * 100))
      : 0;

  const websharePct =
    webshareRes?.quota_used !== null &&
    webshareRes?.quota_used !== undefined &&
    webshareRes?.quota_limit
      ? Math.min(100, Math.round((webshareRes.quota_used / webshareRes.quota_limit) * 100))
      : 0;

  const websharePoolCount = Number(
    webshareRes?.details?.proxy_pool_count ?? 0,
  );

  const filterButtons: Array<{ key: FilterOption; label: string }> = [
    { key: "all", label: t("health.filterAll") },
    { key: "cloud_api", label: t("health.filterCloudApi") },
    { key: "auth", label: t("health.filterAuth") },
    { key: "scraper", label: t("health.filterScraper") },
  ];

  return (
    <div id={ANCHORS.viewHealthResources} className="min-w-0 space-y-5">
      {/* Action & sync bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-zinc-500">{t("health.resourcesSubtitle")}</p>
          {inventory?.fetched_at && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              <span className="tabular-nums">
                {t("health.lastSynced")}: {inventory.fetched_at}
              </span>
              {inventory.probed && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                  {t("health.probedBadge")}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || probing}
            className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-gray-50 disabled:opacity-50 sm:min-h-9"
          >
            {t("health.refreshResources")}
          </button>
          <button
            type="button"
            onClick={onProbe}
            disabled={loading || probing}
            aria-busy={probing}
            className="min-h-11 rounded-lg bg-zinc-950 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 sm:min-h-9"
          >
            {probing
              ? t("health.verifyingConnections")
              : t("health.verifyConnections")}
          </button>
        </div>
      </div>

      {/* 4 Compact KPI Cards */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium text-zinc-500">
            {t("health.kpiExternalApis")}
          </div>
          <div className="tabular-nums mt-1 text-2xl font-bold text-zinc-950">
            {activeCount} / {resources.length}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">
            {t("health.kpiActiveCount", {
              active: activeCount,
              total: resources.length,
            })}
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium text-zinc-500">
            {t("health.kpiGeminiQuota")}
          </div>
          <div className="tabular-nums mt-1 text-2xl font-bold text-zinc-950">
            {(geminiRes?.quota_used ?? 0).toLocaleString()}
            <span className="text-sm font-normal text-zinc-400">
              {" "}
              / {(geminiRes?.quota_limit ?? 4500).toLocaleString()}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${geminiPct}%` }}
            />
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium text-zinc-500">
            {t("health.kpiWebshareBandwidth")}
          </div>
          <div className="tabular-nums mt-1 text-2xl font-bold text-zinc-950">
            {webshareRes?.quota_used !== null && webshareRes?.quota_used !== undefined
              ? `${webshareRes.quota_used.toFixed(1)} MB`
              : "—"}
            <span className="text-sm font-normal text-zinc-400">
              {" "}
              / {Math.round(webshareRes?.quota_limit ?? 1024)} MB
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${websharePct}%` }}
              />
            </div>
            <span className="tabular-nums shrink-0 text-[11px] text-zinc-500">
              {t("health.kpiProxiesCount", { count: websharePoolCount })}
            </span>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium text-zinc-500">
            {t("health.kpiPackages")}
          </div>
          <div className="tabular-nums mt-1 text-2xl font-bold text-zinc-950">
            {backendPkgs.length + frontendPkgs.length}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">
            {t("health.kpiPackagesBreakdown", {
              be: backendPkgs.length,
              fe: frontendPkgs.length,
            })}
          </div>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center gap-2">
        {filterButtons.map((btn) => {
          const isActive = filter === btn.key;
          return (
            <button
              key={btn.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setFilter(btn.key)}
              className={`min-h-11 rounded-full px-3.5 py-1.5 text-xs font-medium transition sm:min-h-8 ${
                isActive
                  ? "bg-zinc-950 text-white"
                  : "bg-gray-100 text-zinc-700 hover:bg-gray-200"
              }`}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      {loading && !inventory ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center text-xs text-zinc-500">
          {t("health.loadingResources")}
        </div>
      ) : (
        <>
          {/* Mobile stacked resource cards (< 768px) */}
          <div className="min-w-0 space-y-2.5 md:hidden">
            {filteredResources.map((res) => {
              const details = summarizeDetails(res);
              return (
                <article
                  key={res.resource_id}
                  className="min-w-0 space-y-2 rounded-xl border border-gray-200 bg-white p-3.5 text-xs"
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-zinc-950">
                        {res.name}
                      </div>
                      <div className="truncate text-[11px] text-zinc-500">
                        {res.provider}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(
                        res.status,
                      )}`}
                    >
                      {statusLabel(res.status)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600">
                    <span>
                      {t("health.colMode")}: <strong>{modeLabel(res.mode)}</strong>
                    </span>
                    <span className="tabular-nums font-mono">
                      {formatQuotaText(res)}
                    </span>
                  </div>
                  {details.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
                      {details.map((line) => (
                        <span
                          key={line}
                          className="rounded-md bg-gray-100 px-2 py-0.5"
                        >
                          {line}
                        </span>
                      ))}
                    </div>
                  )}
                  {res.error && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                      {res.error}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {/* Desktop resource table (>= 768px) */}
          <div
            data-scroll-container="true"
            className="hidden overflow-x-auto rounded-xl border border-gray-200 md:block"
          >
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-2.5">{t("health.colProvider")}</th>
                  <th className="px-3 py-2.5">{t("health.colMode")}</th>
                  <th className="px-3 py-2.5">{t("health.colStatus")}</th>
                  <th className="px-3 py-2.5">{t("health.colQuota")}</th>
                  <th className="px-4 py-2.5">{t("health.colDetails")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredResources.map((res) => {
                  const details = summarizeDetails(res);
                  return (
                    <tr key={res.resource_id} className="hover:bg-gray-50/70">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-zinc-950">
                          {res.name}
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          {res.provider}
                          {res.billing_tier ? ` • ${res.billing_tier}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-zinc-700">
                        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
                          {modeLabel(res.mode)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(
                            res.status,
                          )}`}
                        >
                          {statusLabel(res.status)}
                        </span>
                      </td>
                      <td className="tabular-nums px-3 py-3 font-mono text-[11px] text-zinc-700">
                        {formatQuotaText(res)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {details.map((line) => (
                            <span
                              key={line}
                              className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-zinc-600"
                            >
                              {line}
                            </span>
                          ))}
                        </div>
                        {res.error && (
                          <div className="mt-1.5 text-[11px] text-red-600">
                            {res.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Billing & Charges Ledger */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-950">
            {t("health.chargesTitle")}
          </h2>
          <div className="tabular-nums rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-zinc-950">
            {t("health.chargesTotalLabel")}: $
            {(inventory?.total_charges_usd ?? 0).toFixed(2)}
          </div>
        </div>
        {(inventory?.charges ?? []).length === 0 ? (
          <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-xs text-zinc-600">
            {t("health.chargesEmpty")}
          </p>
        ) : (
          <div
            data-scroll-container="true"
            className="overflow-x-auto rounded-lg border border-gray-200"
          >
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  <th className="px-3 py-2">{t("health.colChargeDate")}</th>
                  <th className="px-3 py-2">{t("health.colProvider")}</th>
                  <th className="px-3 py-2">{t("health.colChargeDesc")}</th>
                  <th className="px-3 py-2">{t("health.colStatus")}</th>
                  <th className="px-3 py-2 text-right">
                    {t("health.colChargeAmount")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(inventory?.charges ?? []).map((charge) => (
                  <tr key={charge.charge_id} className="hover:bg-gray-50/70">
                    <td className="tabular-nums px-3 py-2 text-zinc-500">
                      {charge.created_at || "—"}
                    </td>
                    <td className="px-3 py-2 font-medium text-zinc-950">
                      {charge.provider}
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {charge.description}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-zinc-700">
                        {charge.status}
                      </span>
                    </td>
                    <td className="tabular-nums px-3 py-2 text-right font-mono font-semibold text-zinc-950">
                      {charge.amount.toFixed(2)} {charge.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-zinc-400">{t("health.chargesGcpNote")}</p>
      </div>

      {/* Software Packages Ledger */}
      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-950">
          {t("health.packagesTitle")}
        </h2>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {t("health.backendPackagesTitle")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {backendPkgs.map(([pkg, ver]) => (
                <span
                  key={pkg}
                  className="tabular-nums rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[11px] text-zinc-700"
                >
                  {pkg} <span className="text-zinc-400">v{ver}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {t("health.frontendPackagesTitle")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {frontendPkgs.map(([pkg, ver]) => (
                <span
                  key={pkg}
                  className="tabular-nums rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-[11px] text-zinc-700"
                >
                  {pkg} <span className="text-zinc-400">{ver}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
