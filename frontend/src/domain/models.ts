export const APP_VERSION = "0.3.0";

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
  purple: "bg-gray-100 text-zinc-900 border-gray-200",
  amber: "bg-gray-100 text-zinc-900 border-gray-200",
  emerald: "bg-gray-100 text-zinc-900 border-gray-200",
  blue: "bg-gray-100 text-zinc-900 border-gray-200",
  rose: "bg-gray-100 text-zinc-900 border-gray-200",
  cyan: "bg-gray-100 text-zinc-900 border-gray-200",
  slate: "bg-gray-100 text-zinc-900 border-gray-200",
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
}

export function formatMoney(currency: string, amount: number): string {
  return `${currency}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatSavingsByCurrency(
  entries: Array<{ currency: string; saved_cost: number }>,
  fallbackCurrency = "$",
): string {
  if (entries.length === 0) return formatMoney(fallbackCurrency, 0);
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const prev = totals.get(entry.currency) ?? 0;
    totals.set(entry.currency, prev + Math.max(0, entry.saved_cost));
  }
  return Array.from(totals.entries())
    .map(([curr, sum]) => formatMoney(curr, sum))
    .join(" + ");
}

