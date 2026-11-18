export const APP_VERSION = "0.5.8";

export type BulkTagAction = "add" | "replace" | "remove";

export type TagColor =
  | "purple"
  | "amber"
  | "emerald"
  | "blue"
  | "rose"
  | "cyan"
  | "slate";

export const TAG_COLOR_OPTIONS: readonly TagColor[] = [
  "purple",
  "amber",
  "emerald",
  "blue",
  "rose",
  "cyan",
  "slate",
];

export const TAG_BADGE_CLASSES: Record<TagColor, string> = {
  purple: "bg-purple-50 text-purple-800 border-purple-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  blue: "bg-blue-50 text-blue-800 border-blue-200",
  rose: "bg-rose-50 text-rose-800 border-rose-200",
  cyan: "bg-cyan-50 text-cyan-800 border-cyan-200",
  slate: "bg-slate-100 text-slate-800 border-slate-200",
};

export const TAG_ACTIVE_BADGE_CLASSES: Record<TagColor, string> = {
  purple: "bg-purple-600 text-white border-purple-600",
  amber: "bg-amber-500 text-white border-amber-500",
  emerald: "bg-emerald-600 text-white border-emerald-600",
  blue: "bg-blue-600 text-white border-blue-600",
  rose: "bg-rose-600 text-white border-rose-600",
  cyan: "bg-cyan-600 text-white border-cyan-600",
  slate: "bg-slate-600 text-white border-slate-600",
};

export const TAG_DOT_CLASSES: Record<TagColor, string> = {
  purple: "bg-purple-600",
  amber: "bg-amber-500",
  emerald: "bg-emerald-600",
  blue: "bg-blue-600",
  rose: "bg-rose-600",
  cyan: "bg-cyan-600",
  slate: "bg-slate-600",
};

export interface Tag {
  tag_id: string;
  name: string;
  color: TagColor;
  created_at: string;
}

export interface ItemTag {
  item_id: string;
  tag_id: string;
  assigned_at: string;
}

export interface TrackedItem {
  item_id: string;
  name: string;
  url: string;
  image_url: string;
  currency: string;
  initial_price: number;
  current_price: number;
  target_price: number;
  lowest_price: number;
  status: "ACTIVE" | "DISCOUNT";
  drop_pct: number;
  last_checked: string;
  tag_ids: string[];
}

export interface BoughtItem {
  item_id: string;
  name: string;
  url: string;
  image_url: string;
  currency: string;
  initial_price: number;
  purchased_price: number;
  saved_cost: number;
  purchased_date: string;
  tag_ids: string[];
}

export interface PriceSnapshot {
  history_id: string;
  item_id: string;
  recorded_at: string;
  price: number;
  delta_pct: number;
  event_type: "INITIAL" | "CHECK" | "BOUGHT" | "RESUMED";
}

export interface TelemetryRun {
  run_id: string;
  started_at: string;
  status: "SUCCESS" | "PARTIAL" | "ERROR";
  items_checked: number;
  breakdown: string;
  duration_ms: number;
  errors?: string[];
}

export interface ConfigEntry {
  key: string;
  value: string;
  description: string;
}

export interface WorkspaceState {
  items: TrackedItem[];
  bought_items: BoughtItem[];
  tags: Tag[];
  item_tags: ItemTag[];
  price_history: PriceSnapshot[];
  telemetry_logs: TelemetryRun[];
  config: ConfigEntry[];
}

export interface ScrapePreview {
  url: string;
  title: string;
  price: number;
  currency: string;
  image_url: string;
  extraction_tier: string;
  suggested_tags: string[];
}

export interface BatchPreviewItemResult {
  url: string;
  success: boolean;
  preview: ScrapePreview | null;
  error: string | null;
}

export interface BatchPreviewResponse {
  results: BatchPreviewItemResult[];
}

export interface RuntimeDiagnostics {
  app_version: string;
  python_executable: string;
  python_version: string;
  platform: string;
  workspace_dir: string;
  storage_adapter: string;
  dependency_versions: Record<string, string>;
  recent_logs: Array<{
    timestamp: string;
    level: string;
    message: string;
    traceback_text: string | null;
  }>;
}

export interface AddItemPayload {
  name: string;
  url: string;
  image_url: string;
  currency: string;
  initial_price: number;
  target_price: number;
  tag_names: string[];
}

export interface UpdateItemPayload {
  name?: string;
  target_price?: number;
  tag_names?: string[];
  current_price?: number;
}

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  USD: "$",
  EUR: "€",
  UAH: "₴",
  ГРН: "₴",
  GBP: "£",
  PLN: "zł",
  ZŁ: "zł",
  $: "$",
  "€": "€",
  "₴": "₴",
  "£": "£",
  zł: "zł",
};

/**
 * Normalize ISO currency codes or symbols (e.g. "UAH", "USD") to canonical symbols.
 */
export function normalizeCurrencySymbol(
  raw: string | undefined | null,
  fallback = "$",
): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return fallback;
  return CURRENCY_SYMBOL_MAP[trimmed.toUpperCase()] ?? trimmed;
}

/**
 * Normalize raw pre-filled price strings (spaces, NBSP, comma-decimals) to a clean decimal string.
 */
export function normalizePriceInput(raw: string | undefined | null): string {
  const cleaned = (raw ?? "").replace(/[\s\u00a0]+/g, "").trim();
  if (!cleaned) return "";
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = `${parts[0]}.${parts[1]}`;
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num <= 0) return "";
  return normalized;
}

export function formatMoney(
  currency: string,
  amount: number,
  locale = "en-US",
): string {
  return `${currency}${amount.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatSavingsByCurrency(
  entries: Array<{ currency: string; saved_cost: number }>,
  fallbackCurrency = "$",
  locale = "en-US",
): string {
  if (entries.length === 0) return formatMoney(fallbackCurrency, 0, locale);
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const prev = totals.get(entry.currency) ?? 0;
    totals.set(entry.currency, prev + Math.max(0, entry.saved_cost));
  }
  return Array.from(totals.entries())
    .map(([curr, sum]) => formatMoney(curr, sum, locale))
    .join(" + ");
}

/**
 * Extracts a clean lowercase retailer domain from a product URL
 * (e.g., "https://www.levi.com/US/..." -> "levi.com").
 */
export function extractDomain(rawUrl: string | undefined | null): string {
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(
      /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
        ? trimmed
        : `https://${trimmed}`,
    );
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type ResourceCategory = "cloud_api" | "auth" | "scraper" | "infra";
export type ResourceMode = "live" | "mock" | "disabled" | "configured";
export type ResourceHealthStatus = "operational" | "warning" | "disabled";

export interface ChargeRecord {
  charge_id: string;
  provider: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

export interface ThirdPartyResource {
  resource_id: string;
  name: string;
  category: ResourceCategory;
  provider: string;
  mode: ResourceMode;
  status: ResourceHealthStatus;
  endpoint: string;
  quota_used: number | null;
  quota_limit: number | null;
  quota_unit: string;
  billing_tier?: string;
  monthly_cost_usd?: number;
  reset_at: string | null;
  last_activity_at: string | null;
  details: Record<string, unknown>;
  error: string | null;
}

export interface ResourcesInventory {
  app_version: string;
  fetched_at: string;
  probed: boolean;
  storage_adapter: string;
  scraper_adapter: string;
  auth_mode: string;
  resources: ThirdPartyResource[];
  backend_packages: Record<string, string>;
  charges?: ChargeRecord[];
  total_charges_usd?: number;
}

export const FRONTEND_PACKAGES: Record<string, string> = {
  react: "^19.0.0",
  "react-dom": "^19.0.0",
  vite: "^6.0.0",
  typescript: "^5.7.2",
  tailwindcss: "^4.0.0",
  "@playwright/test": "^1.49.0",
  "eslint-plugin-jsx-a11y": "^6.10.2",
};

