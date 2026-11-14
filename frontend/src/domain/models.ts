export const APP_VERSION = "0.2.1";

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
  purple: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  amber: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  blue: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  rose: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  cyan: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  slate: "bg-slate-500/20 text-slate-300 border-slate-500/30",
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
): string {
  if (entries.length === 0) return "$0.00";
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const prev = totals.get(entry.currency) ?? 0;
    totals.set(entry.currency, prev + Math.max(0, entry.saved_cost));
  }
  return Array.from(totals.entries())
    .map(([curr, sum]) => formatMoney(curr, sum))
    .join(" + ");
}

