import { useMemo, useState } from "react";
import type { PriceSnapshot, Tag, TrackedItem } from "../domain/models";
import { formatMoney } from "../domain/models";
import { ANCHORS } from "../shared/anchors";

const SERIES_PALETTE: readonly string[] = [
  "#2563EB", // Cobalt Blue
  "#059669", // Emerald
  "#D97706", // Amber
  "#9333EA", // Violet
  "#E11D48", // Rose
  "#0891B2", // Cyan
  "#4F46E5", // Indigo
  "#EA580C", // Orange
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
  const [seriesMode, setSeriesMode] = useState<"all" | "top5" | "custom">("all");
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

  const colorByItemId = useMemo(
    () =>
      new Map(
        items.map((item, idx) => [
          item.item_id,
          SERIES_PALETTE[idx % SERIES_PALETTE.length],
        ]),
      ),
    [items],
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
    setSeriesMode("custom");
    if (allSelected) {
      setExcludedIds(new Set(filteredItems.map((i) => i.item_id)));
    } else {
      setExcludedIds(new Set());
    }
  };

  const selectTop5Drops = () => {
    setSeriesMode("top5");
    const top5 = new Set(
      [...filteredItems]
        .sort((a, b) => b.drop_pct - a.drop_pct)
        .slice(0, 5)
        .map((i) => i.item_id),
    );
    setExcludedIds(
      new Set(
        filteredItems.filter((i) => !top5.has(i.item_id)).map((i) => i.item_id),
      ),
    );
  };

  const selectAllInView = () => {
    setSeriesMode("all");
    setExcludedIds(new Set());
  };

  const toggleItem = (itemId: string) => {
    setSeriesMode("custom");
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
  const plotBottomY = height - padY;

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
      if (timestamps.length <= 1) {
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
        return new Date(ms).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
      };
      const count = Math.min(5, timestamps.length);
      const seen = new Set<string>();
      const labels: string[] = [];
      for (let i = 0; i < count; i++) {
        const idx =
          count === 1
            ? timestamps.length - 1
            : Math.round((i / (count - 1)) * (timestamps.length - 1));
        const iso = timestamps[idx];
        let candidate = formatTickLabel(iso, i === count - 1);
        if (seen.has(candidate) && i < count - 1) {
          const dt = new Date(iso);
          candidate = Number.isNaN(dt.getTime())
            ? iso.slice(0, 16)
            : dt.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            });
          if (seen.has(candidate)) {
            candidate = iso.slice(11, 16) || `${candidate} (${i + 1})`;
          }
        }
        seen.add(candidate);
        labels.push(candidate);
      }
      return labels;
    }, [allSnapshots]);

  const primaryItemId = hoveredItemId ?? visibleItems[0]?.item_id ?? null;

  const orderedVisibleItems = useMemo(() => {
    if (!primaryItemId) return visibleItems;
    const secondary = visibleItems.filter((i) => i.item_id !== primaryItemId);
    const primary = visibleItems.filter((i) => i.item_id === primaryItemId);
    return [...secondary, ...primary];
  }, [visibleItems, primaryItemId]);

  return (
    <section
      id={ANCHORS.chartPanel}
      aria-label="Total Price Dynamic and Market Trajectory"
      className="@container min-w-0 rounded-xl border border-gray-200 bg-white p-3.5 sm:p-4"
    >
      <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-950">
              Total Price Dynamic &amp; Market Trajectory (%)
            </h2>
              <p className="text-[11px] text-zinc-500">
                Normalized % delta relative to each item&apos;s initial baseline (0%)
              </p>
            </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={selectTop5Drops}
                  className={`min-h-11 rounded-full px-3 py-1 text-xs font-medium transition-colors sm:min-h-8 ${seriesMode === "top5"
                      ? "bg-zinc-950 text-white"
                      : "bg-gray-100 text-zinc-900 hover:bg-gray-200"
                    }`}
                >
                  Top 5 Drops
                </button>
                <button
                  type="button"
                  onClick={selectAllInView}
                  className={`min-h-11 rounded-full px-3 py-1 text-xs font-medium transition-colors sm:min-h-8 ${seriesMode === "all"
                      ? "bg-zinc-950 text-white"
                      : "bg-gray-100 text-zinc-900 hover:bg-gray-200"
                    }`}
                >
                  All in View
                </button>
              </div>
            </div>

                  <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
                    <div className="relative min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white lg:col-span-8">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 text-[11px]">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="inline-flex items-center gap-1.5 text-zinc-600">
                              <span
                                aria-hidden="true"
                                className="inline-block w-3 border-t border-dashed border-zinc-400"
                              />
                              0.0% Baseline
                            </span>
                              <span className="font-medium text-blue-600">
                                &darr; Negative % = Price Drop
                              </span>
                            </div>
                              <span className="tabular-nums text-zinc-500">
                                Visible: {visibleItems.length} of {filteredItems.length} items
                              </span>
                            </div>

                            <svg
                              viewBox={`0 0 ${width} ${height}`}
                              role="img"
                              aria-label="Normalized percentage price trajectory chart"
                              className="h-44 w-full sm:h-60"
                            >
                              <defs>
                                <linearGradient id="cobaltArea" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#2563EB" stopOpacity="0.14" />
                                  <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
                                </linearGradient>
                              </defs>

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
                                      stroke={isZero ? "#D4D4D8" : "#F3F4F6"}
                                      strokeDasharray={isZero ? "4 4" : undefined}
                                    />
                                    <text
                                      x={padX - 6}
                                      y={y + 3.5}
                                      textAnchor="end"
                                      fill={isZero ? "#09090B" : "#71717A"}
                                      fontSize="10"
                                      fontWeight={isZero ? "600" : "400"}
                                      style={{ fontVariantNumeric: "tabular-nums" }}
                                    >
                                      {label}
                                    </text>
                                  </g>
                                );
                              })}

                                {
                                  orderedVisibleItems.map((item) => {
                                    const snaps = priceHistory
                                      .filter((s) => s.item_id === item.item_id)
                                      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
                                    if (snaps.length === 0) return null;
                                    const isPrimary = item.item_id === primaryItemId;
                                    const isDimmed = hoveredItemId !== null && !isPrimary;
                                    const seriesColor =
                                      colorByItemId.get(item.item_id) ??
                                      SERIES_PALETTE[0];
                                    const strokeColor = seriesColor;
                                    const dotColor = seriesColor;
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
                                    const firstPt = points[0];
                                    const lastPt = points[points.length - 1];

                                    return (
                <g key={item.item_id} opacity={isDimmed ? 0.25 : 1}>
                  {isPrimary && points.length > 1 && (
                    <polygon
                      points={`${polyline} ${lastPt.x},${plotBottomY} ${firstPt.x},${plotBottomY}`}
                      fill="url(#cobaltArea)"
                    />
                  )}
                  {points.length === 1 ? (
                    <line
                      x1={Math.max(padX, points[0].x - 36)}
                      y1={points[0].y}
                      x2={points[0].x}
                      y2={points[0].y}
                      stroke={strokeColor}
                      strokeWidth={isPrimary ? "2.25" : "1.75"}
                      strokeDasharray="4 3"
                      strokeLinecap="round"
                    />
                  ) : (
                    <polyline
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={isPrimary ? "2.25" : "1.75"}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={polyline}
                    />
                  )}
                  {isPrimary && lastPt && (
                    <circle
                      cx={lastPt.x}
                      cy={lastPt.y}
                      r={8}
                      fill={seriesColor}
                      fillOpacity="0.2"
                    />
                  )}
                  {points.map((pt) => (
                    <circle
                      key={pt.snap.history_id}
                      cx={pt.x}
                      cy={pt.y}
                      r={isPrimary ? 4 : 3}
                      fill={dotColor}
                      stroke="#FFFFFF"
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

          <div className="tabular-nums flex items-center justify-between gap-1 border-t border-gray-100 px-3 py-2 text-[10px] text-zinc-500 sm:text-[11px]">
            {timelineLabels.map((lbl, idx) => (
              <span
                key={`${lbl}-${idx}`}
                className={`truncate ${
                  idx === timelineLabels.length - 1
                    ? "font-medium text-zinc-700"
                    : ""
                }`}
              >
                {lbl}
              </span>
            ))}
          </div>

          {hoveredPoint && (
            <div
              role="status"
              className="pointer-events-none absolute top-11 right-2 left-2 rounded-lg border border-gray-200 bg-white/95 px-3 py-2 text-xs shadow-lg sm:top-12 sm:right-auto sm:left-12"
            >
              <div className="font-semibold text-zinc-950">
                {hoveredPoint.itemName}
              </div>
              <div className="text-zinc-500">Tags: {hoveredPoint.tagNames}</div>
              <div className="tabular-nums font-medium text-blue-600">
                {hoveredPoint.priceText} ({hoveredPoint.deltaPct}%) &bull;{" "}
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
            className="mb-2 flex min-h-11 w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-gray-100 lg:hidden"
          >
            <span className="tabular-nums">
              Series Filters ({visibleItems.length}/{filteredItems.length})
            </span>
            <span className="text-zinc-600">
              {mobileControlsOpen ? "Hide \u25B2" : "Show \u25BC"}
            </span>
          </button>

          <aside
            id={ANCHORS.chartPanelControls}
            aria-label="Chart series controls"
            className={`${
              mobileControlsOpen ? "flex" : "hidden"
            } min-w-0 w-full flex-col gap-2.5 rounded-xl border border-gray-200 bg-gray-50/50 p-3 lg:flex lg:rounded-none lg:border-0 lg:border-l lg:border-gray-100 lg:bg-transparent lg:p-0 lg:pl-4`}
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="tabular-nums truncate text-xs font-semibold text-zinc-950">
                Series Visible ({visibleItems.length}/{filteredItems.length})
              </span>
              <button
                type="button"
                onClick={toggleAll}
                className="min-h-11 shrink-0 px-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-950 sm:min-h-8"
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
              className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-zinc-950 focus:outline-none focus:ring-1 focus:ring-zinc-950 sm:min-h-9"
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
              className="min-h-11 w-full rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-950 sm:min-h-9"
            />

            <div
              id={ANCHORS.chartSeriesCheckboxes}
              className="max-h-44 space-y-1 overflow-y-auto pr-1 sm:max-h-40"
            >
              {filteredItems.map((item) => {
                const checked = !excludedIds.has(item.item_id);
                const seriesColor =
                  colorByItemId.get(item.item_id) ?? SERIES_PALETTE[0];
                return (
                  <label
                    key={item.item_id}
                    className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-gray-50 sm:min-h-8"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(item.item_id)}
                        onFocus={() => setHoveredItemId(item.item_id)}
                        onBlur={() => setHoveredItemId(null)}
                        className="h-3.5 w-3.5 shrink-0 rounded accent-zinc-950"
                      />
                      <span
                        aria-hidden="true"
                        data-series-dot="true"
                        style={{
                          backgroundColor: checked ? seriesColor : "#D4D4D8",
                        }}
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                      />
                      <span className="truncate text-zinc-800" title={item.name}>
                        {item.name}
                      </span>
                    </span>
                    <span className="tabular-nums shrink-0 text-[11px] text-zinc-500">
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
