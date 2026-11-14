import { useMemo, useState } from "react";
import type { PriceSnapshot, Tag, TrackedItem } from "../domain/models";
import { formatMoney } from "../domain/models";
import { ANCHORS } from "../shared/anchors";

const SERIES_COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#a855f7",
  "#f43f5e",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

interface TrajectoryChartProps {
  items: TrackedItem[];
  tags: Tag[];
  priceHistory: PriceSnapshot[];
  activeTagFilter: string;
  onTagFilterChange: (tagId: string) => void;
}

export function TrajectoryChart({
  items,
  tags,
  priceHistory,
  activeTagFilter,
  onTagFilterChange,
}: TrajectoryChartProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<{
    itemName: string;
    tagNames: string;
    recordedAt: string;
    priceText: string;
    deltaPct: number;
    x: number;
    y: number;
  } | null>(null);

  const tagNameById = useMemo(
    () => new Map(tags.map((t) => [t.tag_id, t.name])),
    [tags],
  );

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (activeTagFilter !== "ALL" && !item.tag_ids.includes(activeTagFilter)) {
        return false;
      }
      if (!q) return true;
      const itemTagNames = item.tag_ids
        .map((id) => tagNameById.get(id) ?? "")
        .join(" ")
        .toLowerCase();
      return item.name.toLowerCase().includes(q) || itemTagNames.includes(q);
    });
  }, [items, activeTagFilter, searchQuery, tagNameById]);

  const visibleItems = useMemo(
    () => filteredItems.filter((item) => !excludedIds.has(item.item_id)),
    [filteredItems, excludedIds],
  );

  const allSelected =
    filteredItems.length > 0 && visibleItems.length === filteredItems.length;

  const toggleAll = () => {
    if (allSelected) {
      setExcludedIds(new Set(filteredItems.map((i) => i.item_id)));
    } else {
      setExcludedIds(new Set());
    }
  };

  const selectTop5Drops = () => {
    const top5 = new Set(
      [...filteredItems]
        .sort((a, b) => b.drop_pct - a.drop_pct)
        .slice(0, 5)
        .map((i) => i.item_id),
    );
    setExcludedIds(
      new Set(filteredItems.filter((i) => !top5.has(i.item_id)).map((i) => i.item_id)),
    );
  };

  const toggleItem = (itemId: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const width = 640;
  const height = 240;
  const padX = 46;
  const padY = 20;

  const allSnapshots = useMemo(() => {
    const visibleSet = new Set(visibleItems.map((i) => i.item_id));
    return priceHistory.filter((snap) => visibleSet.has(snap.item_id));
  }, [priceHistory, visibleItems]);

  const minTick = Math.min(
    -30,
    Math.floor(Math.min(0, ...allSnapshots.map((s) => s.delta_pct)) / 5) * 5,
  );
  const maxTick = Math.max(
    5,
    Math.ceil(Math.max(5, ...allSnapshots.map((s) => s.delta_pct)) / 5) * 5,
  );
  const yTicks: number[] = [];
  for (let t = maxTick; t >= minTick; t -= 5) {
    yTicks.push(t);
  }
  const span = Math.max(1, maxTick - minTick);
  const toY = (delta: number) =>
    padY + ((maxTick - delta) / span) * (height - padY * 2);

  const plotWidth = width - padX - 24;
  const parsedTimes = useMemo(
    () =>
      allSnapshots
        .map((s) => Date.parse(s.recorded_at))
        .filter((t) => !Number.isNaN(t)),
    [allSnapshots],
  );
  const minTs = parsedTimes.length > 0 ? Math.min(...parsedTimes) : 0;
  const maxTs = parsedTimes.length > 0 ? Math.max(...parsedTimes) : 1;
  const timeSpan = Math.max(1, maxTs - minTs);
  const toX = (recordedAt: string, idx: number, total: number) => {
    const ts = Date.parse(recordedAt);
    if (!Number.isNaN(ts) && maxTs > minTs) {
      return padX + ((ts - minTs) / timeSpan) * plotWidth;
    }
    return total > 1 ? padX + (idx / (total - 1)) * plotWidth : padX + plotWidth;
  };

  const timelineLabels = useMemo(() => {
    const timestamps = Array.from(
      new Set(allSnapshots.map((s) => s.recorded_at)),
    ).sort((a, b) => a.localeCompare(b));
    if (timestamps.length === 0) {
      return ["Baseline", "Latest Check (Pooled)"];
    }
    if (timestamps.length === 1) {
      return ["Baseline", "Latest Check (Pooled)"];
    }
    const latestMs = Date.parse(timestamps[timestamps.length - 1]);
    const formatTickLabel = (iso: string, isLast: boolean) => {
      if (isLast) return "Latest Check (Pooled)";
      const ms = Date.parse(iso);
      if (Number.isNaN(ms) || Number.isNaN(latestMs)) {
        return iso.slice(0, 10);
      }
      const diffDays = Math.round((latestMs - ms) / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) return iso.slice(11, 16) || "Today";
      if (diffDays === 1) return "Yesterday";
      return `${diffDays} Days Ago`;
    };
    const count = Math.min(5, timestamps.length);
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx =
        count === 1
          ? timestamps.length - 1
          : Math.round((i / (count - 1)) * (timestamps.length - 1));
      labels.push(formatTickLabel(timestamps[idx], i === count - 1));
    }
    return labels;
  }, [allSnapshots]);

  return (
    <section
      id={ANCHORS.chartPanel}
      aria-label="Total Price Dynamic and Market Trajectory"
      className="@container min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4"
    >
      <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">
            Total Price Dynamic &amp; Market Trajectory (%)
          </h2>
          <p className="text-xs text-slate-400">
            Normalized % delta relative to each item&apos;s initial baseline (0%)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={selectTop5Drops}
            className="min-h-11 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 sm:min-h-9 sm:px-2.5 sm:py-1"
          >
            Top 5 Drops
          </button>
          <button
            type="button"
            onClick={() => setExcludedIds(new Set())}
            className="min-h-11 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 sm:min-h-9 sm:px-2.5 sm:py-1"
          >
            All in View
          </button>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-12">
        <div className="relative min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/75 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-3 py-2 font-mono text-[11px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-slate-300">
                <span
                  aria-hidden="true"
                  className="inline-block w-3 border-t border-dashed border-slate-400"
                />
                0.0% Baseline
              </span>
              <span className="text-emerald-400">
                &darr; Negative % = Price Drop
              </span>
            </div>
            <span className="text-slate-400">
              Visible: {visibleItems.length} of {filteredItems.length} items
            </span>
          </div>

          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Normalized percentage price trajectory chart"
            className="h-44 w-full sm:h-60"
          >
            {yTicks.map((tick) => {
              const y = toY(tick);
              const isZero = tick === 0;
              const label = tick > 0 ? `+${tick}%` : `${tick}%`;
              return (
                <g key={tick}>
                  <line
                    x1={padX}
                    y1={y}
                    x2={width - 16}
                    y2={y}
                    stroke={isZero ? "#475569" : "#1e293b"}
                    strokeDasharray={isZero ? "6 4" : undefined}
                  />
                  <text
                    x={padX - 6}
                    y={y + 3.5}
                    textAnchor="end"
                    fill={isZero ? "#10b981" : "#94a3b8"}
                    fontSize="10"
                    fontWeight={isZero ? "700" : "400"}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            {visibleItems.map((item, idx) => {
              const snaps = priceHistory
                .filter((s) => s.item_id === item.item_id)
                .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
              if (snaps.length === 0) return null;
              const color = SERIES_COLORS[idx % SERIES_COLORS.length];
              const isHighlighted = hoveredItemId === item.item_id;
              const isDimmed = hoveredItemId !== null && !isHighlighted;
              const points = snaps.map((snap, sIdx) => ({
                x: toX(snap.recorded_at, sIdx, snaps.length),
                y: toY(snap.delta_pct),
                snap,
              }));
              const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
              const tagNames = item.tag_ids
                .map((id) => tagNameById.get(id))
                .filter(Boolean)
                .join(", ");

              return (
                <g
                  key={item.item_id}
                  opacity={isDimmed ? 0.2 : 1}
                >
                  {points.length === 1 ? (
                    <line
                      x1={Math.max(padX, points[0].x - 36)}
                      y1={points[0].y}
                      x2={points[0].x}
                      y2={points[0].y}
                      stroke={color}
                      strokeWidth={isHighlighted ? "3.5" : "2.25"}
                      strokeDasharray="4 3"
                      strokeLinecap="round"
                    />
                  ) : (
                    <polyline
                      fill="none"
                      stroke={color}
                      strokeWidth={isHighlighted ? "3.5" : "2.25"}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={polyline}
                    />
                  )}
                  {points.map((pt) => (
                    <circle
                      key={pt.snap.history_id}
                      cx={pt.x}
                      cy={pt.y}
                      r={4}
                      fill={color}
                      stroke="#020617"
                      strokeWidth="1.5"
                      className="cursor-pointer"
                      onMouseEnter={() =>
                        setHoveredPoint({
                          itemName: item.name,
                          tagNames: tagNames || "Untagged",
                          recordedAt: pt.snap.recorded_at,
                          priceText: formatMoney(item.currency, pt.snap.price),
                          deltaPct: pt.snap.delta_pct,
                          x: pt.x,
                          y: pt.y,
                        })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                      onClick={() =>
                        setHoveredPoint({
                          itemName: item.name,
                          tagNames: tagNames || "Untagged",
                          recordedAt: pt.snap.recorded_at,
                          priceText: formatMoney(item.currency, pt.snap.price),
                          deltaPct: pt.snap.delta_pct,
                          x: pt.x,
                          y: pt.y,
                        })
                      }
                    />
                  ))}
                </g>
              );
            })}
          </svg>

          <div className="flex items-center justify-between gap-1 border-t border-slate-800/80 px-3 py-2 font-mono text-[10px] text-slate-400 sm:text-[11px]">
            {timelineLabels.map((lbl, idx) => (
              <span key={`${lbl}-${idx}`} className="truncate">
                {lbl}
              </span>
            ))}
          </div>

          {hoveredPoint && (
            <div
              role="status"
              className="pointer-events-none absolute top-11 left-2 right-2 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs shadow-xl sm:top-12 sm:left-12 sm:right-auto"
            >
              <div className="font-semibold text-slate-100">
                {hoveredPoint.itemName}
              </div>
              <div className="text-slate-400">Tags: {hoveredPoint.tagNames}</div>
              <div className="text-emerald-300">
                {hoveredPoint.priceText} ({hoveredPoint.deltaPct}%) •{" "}
                {hoveredPoint.recordedAt}
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 w-full lg:col-span-4">
          <button
            type="button"
            aria-expanded={mobileControlsOpen}
            aria-controls={ANCHORS.chartPanelControls}
            onClick={() => setMobileControlsOpen((prev) => !prev)}
            className="mb-2 flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800/70 lg:hidden"
          >
            <span>
              Series Filters ({visibleItems.length}/{filteredItems.length})
            </span>
            <span className="text-emerald-400">
              {mobileControlsOpen ? "Hide \u25B2" : "Show \u25BC"}
            </span>
          </button>

          <aside
            id={ANCHORS.chartPanelControls}
            aria-label="Chart series controls"
            className={`${
              mobileControlsOpen ? "flex" : "hidden"
            } min-w-0 w-full flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 lg:flex`}
          >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-slate-200">
              Series Visible ({visibleItems.length}/{filteredItems.length})
            </span>
            <button
              type="button"
              onClick={toggleAll}
              className="min-h-11 shrink-0 px-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 sm:min-h-9"
            >
              {allSelected ? "Unselect All" : "Select All"}
            </button>
          </div>

          <label htmlFor={ANCHORS.chartCategoryFilter} className="sr-only">
            Filter chart by tag
          </label>
          <select
            id={ANCHORS.chartCategoryFilter}
            aria-label="Filter chart by tag"
            value={activeTagFilter}
            onChange={(e) => onTagFilterChange(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 sm:min-h-9"
          >
            <option value="ALL">All Tags ({tags.length})</option>
            {tags.map((tag) => (
              <option key={tag.tag_id} value={tag.tag_id}>
                {tag.name}
              </option>
            ))}
          </select>

          <label htmlFor="chart-series-search" className="sr-only">
            Filter series
          </label>
          <input
            id="chart-series-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter series..."
            className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 sm:min-h-9"
          />

          <div
            id={ANCHORS.chartSeriesCheckboxes}
            className="max-h-44 space-y-1 overflow-y-auto pr-1 sm:max-h-40 sm:space-y-1.5"
          >
            {filteredItems.map((item, idx) => {
              const checked = !excludedIds.has(item.item_id);
              const color = SERIES_COLORS[idx % SERIES_COLORS.length];
              return (
                <label
                  key={item.item_id}
                  className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-slate-800/60 sm:min-h-9"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleItem(item.item_id)}
                      onFocus={() => setHoveredItemId(item.item_id)}
                      onBlur={() => setHoveredItemId(null)}
                      className="rounded border-slate-600"
                    />
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="truncate text-slate-200" title={item.name}>
                      {item.name}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-emerald-400">
                    -{item.drop_pct}%
                  </span>
                </label>
              );
            })}
          </div>
          </aside>
        </div>
      </div>
    </section>
  );
}

