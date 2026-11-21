import { useMemo, useState } from "react";
import type { PriceSnapshot, Tag, TrackedItem } from "../domain/models";
import { formatMoney } from "../domain/models";
import { ANCHORS } from "../shared/anchors";
import { useI18n } from "../shared/i18n";

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

interface HoveredChartPoint {
  historyId: string;
  itemId: string;
  itemName: string;
  seriesColor: string;
  tagNames: string;
  recordedAt: string;
  formattedTime: string;
  priceText: string;
  baselineText: string;
  deltaPct: number;
  checkIndex: number;
  totalChecks: number;
  eventType: string;
  x: number;
  y: number;
}

interface ChartBulletPoint {
  historyId: string;
  itemId: string;
  itemName: string;
  seriesColor: string;
  tagNames: string;
  recordedAt: string;
  formattedTime: string;
  priceText: string;
  baselineText: string;
  trueDeltaPct: number;
  checkIndex: number;
  totalChecks: number;
  eventType: string;
  seriesIdx: number;
  sIdx: number;
  rawX: number;
  rawY: number;
  lineY: number;
  cx: number;
  cy: number;
}

interface SeriesTrajectory {
  item: TrackedItem;
  seriesColor: string;
  points: ChartBulletPoint[];
}

function formatSnapshotTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} UTC`;
}

function computeTrueDeltaPct(item: TrackedItem, snap: PriceSnapshot): number {
  if (item.initial_price > 0) {
    return (
      Math.round(
        ((snap.price - item.initial_price) / item.initial_price) * 1000,
      ) / 10
    );
  }
  return snap.delta_pct;
}

interface TrajectoryChartProps {
  items: TrackedItem[];
  tags: Tag[];
  priceHistory: PriceSnapshot[];
  activeTagFilter: string;
  onTagFilterChange: (tagId: string) => void;
  onOpenItem?: (itemId: string) => void;
}

export function TrajectoryChart({
  items,
  tags,
  priceHistory,
  activeTagFilter,
  onTagFilterChange,
  onOpenItem,
}: TrajectoryChartProps) {
  const { locale, t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [seriesMode, setSeriesMode] = useState<"all" | "top5" | "custom">("all");
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<HoveredChartPoint | null>(
    null,
  );

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

  const clearHover = () => {
    setHoveredPoint(null);
    setHoveredItemId(null);
  };

  const toggleAll = () => {
    clearHover();
    setSeriesMode("custom");
    if (allSelected) {
      setExcludedIds(new Set(filteredItems.map((i) => i.item_id)));
    } else {
      setExcludedIds(new Set());
    }
  };

  const selectTop5Drops = () => {
    clearHover();
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
    clearHover();
    setSeriesMode("all");
    setExcludedIds(new Set());
  };

  const toggleItem = (itemId: string) => {
    clearHover();
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

  const visibleItemById = useMemo(
    () => new Map(visibleItems.map((i) => [i.item_id, i])),
    [visibleItems],
  );

  const allSnapshots = useMemo(
    () => priceHistory.filter((snap) => visibleItemById.has(snap.item_id)),
    [priceHistory, visibleItemById],
  );

  const visibleDeltas = useMemo(
    () =>
      allSnapshots.map((snap) => {
        const item = visibleItemById.get(snap.item_id);
        return item ? computeTrueDeltaPct(item, snap) : snap.delta_pct;
      }),
    [allSnapshots, visibleItemById],
  );

  const minTick = Math.min(
    -30,
    Math.floor(Math.min(0, ...visibleDeltas) / 5) * 5,
  );
  const maxTick = Math.max(
    5,
    Math.ceil(Math.max(5, ...visibleDeltas) / 5) * 5,
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

  const timelineLabels = useMemo(() => {
    const timestamps = Array.from(
      new Set(allSnapshots.map((s) => s.recorded_at)),
    ).sort((a, b) => a.localeCompare(b));
      if (timestamps.length <= 1) {
        return [t("chart.baselineLabel"), t("chart.latestCheckPooled")];
      }
      const latestMs = Date.parse(timestamps[timestamps.length - 1]);
      const formatTickLabel = (iso: string, isLast: boolean) => {
        if (isLast) return t("chart.latestCheckPooled");
        const ms = Date.parse(iso);
        if (Number.isNaN(ms) || Number.isNaN(latestMs)) {
          return iso.slice(0, 10);
        }
        const diffDays = Math.round((latestMs - ms) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) return iso.slice(11, 16) || t("chart.today");
        if (diffDays === 1) return t("chart.yesterday");
        return new Date(ms).toLocaleDateString(locale, {
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
            : dt.toLocaleDateString(locale, {
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
    }, [allSnapshots, locale, t]);

  const primaryItemId = hoveredItemId ?? visibleItems[0]?.item_id ?? null;

  const { seriesTrajectories, allBullets } = useMemo(() => {
    const plotSpanY = Math.max(1, maxTick - minTick);
    const calcY = (delta: number) =>
      padY + ((maxTick - delta) / plotSpanY) * (height - padY * 2);
    const calcX = (recordedAt: string, idx: number, total: number) => {
      const ts = Date.parse(recordedAt);
      if (!Number.isNaN(ts) && maxTs > minTs) {
        return padX + ((ts - minTs) / timeSpan) * plotWidth;
      }
      return total > 1
        ? padX + (idx / (total - 1)) * plotWidth
        : padX + plotWidth;
    };

    const trajectories: SeriesTrajectory[] = [];
    const bullets: ChartBulletPoint[] = [];

    visibleItems.forEach((item, seriesIdx) => {
      const snaps = priceHistory
        .filter((s) => s.item_id === item.item_id)
        .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
      if (snaps.length === 0) return;

      const seriesColor = colorByItemId.get(item.item_id) ?? SERIES_PALETTE[0];
      const tagNames =
        item.tag_ids
          .map((id) => tagNameById.get(id))
          .filter(Boolean)
          .join(", ") || "Untagged";
      const baselineText = formatMoney(item.currency, item.initial_price);
      const maxHalfSpread = 2;
      const lineStep =
        visibleItems.length > 1
          ? Math.min(1.25, (maxHalfSpread * 2) / (visibleItems.length - 1))
          : 0;
      const lineOffset =
        visibleItems.length > 1
          ? (seriesIdx - (visibleItems.length - 1) / 2) * lineStep
          : 0;

      const points: ChartBulletPoint[] = snaps.map((snap, sIdx) => {
        const trueDeltaPct = computeTrueDeltaPct(item, snap);
        const rawX = calcX(snap.recorded_at, sIdx, snaps.length);
        const rawY = calcY(trueDeltaPct);
        const lineY = rawY + lineOffset;
        const pt: ChartBulletPoint = {
          historyId: snap.history_id,
          itemId: item.item_id,
          itemName: item.name,
          seriesColor,
          tagNames,
          recordedAt: snap.recorded_at,
          formattedTime: formatSnapshotTimestamp(snap.recorded_at),
          priceText: formatMoney(item.currency, snap.price, locale),
          baselineText,
          trueDeltaPct,
          checkIndex: sIdx + 1,
          totalChecks: snaps.length,
          eventType: snap.event_type,
          seriesIdx,
          sIdx,
          rawX,
          rawY,
          lineY,
          cx: rawX,
          cy: lineY,
        };
        bullets.push(pt);
        return pt;
      });

      trajectories.push({ item, seriesColor, points });
    });

    const minX = padX;
    const maxX = padX + plotWidth;
    const idealGap = 6;
    const maxClusterHalfSpread = 8;
    const clusters = new Map<string, ChartBulletPoint[]>();
    for (const pt of bullets) {
      const key = `${Math.round(pt.rawX / 6)}:${Math.round(pt.rawY / 6)}`;
      const arr = clusters.get(key);
      if (arr) arr.push(pt);
      else clusters.set(key, [pt]);
    }

    for (const cluster of clusters.values()) {
      if (cluster.length === 1) {
        cluster[0].cx = Math.max(minX, Math.min(maxX, cluster[0].rawX));
        continue;
      }
      cluster.sort(
        (a, b) => a.rawX - b.rawX || a.seriesIdx - b.seriesIdx || a.sIdx - b.sIdx,
      );
      const n = cluster.length;
      const meanRawX =
        cluster.reduce((sum, pt) => sum + pt.rawX, 0) / n;
      const halfSpread = Math.min(
        maxClusterHalfSpread,
        ((n - 1) * idealGap) / 2,
      );
      // Center cluster on meanRawX so bullets remain within ±maxClusterHalfSpread of rawX.
      const centerX = Math.max(minX, Math.min(maxX, meanRawX));
      for (let i = 0; i < n; i++) {
        cluster[i].cx =
          centerX - halfSpread + (i / (n - 1)) * (halfSpread * 2);
      }
    }

    return { seriesTrajectories: trajectories, allBullets: bullets };
  }, [
    visibleItems,
    priceHistory,
    colorByItemId,
    tagNameById,
    maxTick,
    minTick,
    minTs,
    maxTs,
    timeSpan,
    plotWidth,
  ]);

  const orderedTrajectories = useMemo(() => {
    if (!primaryItemId) return seriesTrajectories;
    const secondary = seriesTrajectories.filter(
      (s) => s.item.item_id !== primaryItemId,
    );
    const primary = seriesTrajectories.filter(
      (s) => s.item.item_id === primaryItemId,
    );
    return [...secondary, ...primary];
  }, [seriesTrajectories, primaryItemId]);

  return (
    <section
      id={ANCHORS.chartPanel}
      aria-label={t("chart.title")}
      className="@container min-w-0 rounded-xl border border-gray-200 bg-white p-3.5 sm:p-4"
    >
      <div className="mb-3 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-950">
              {t("chart.title")}
            </h2>
              <p className="text-[11px] text-zinc-500">
                {t("chart.subtitle")}
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
                  {t("chart.presetTop5")}
                </button>
                <button
                  type="button"
                  onClick={selectAllInView}
                  className={`min-h-11 rounded-full px-3 py-1 text-xs font-medium transition-colors sm:min-h-8 ${seriesMode === "all"
                      ? "bg-zinc-950 text-white"
                      : "bg-gray-100 text-zinc-900 hover:bg-gray-200"
                    }`}
                >
                  {t("chart.presetAll")}
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
                              {t("chart.baseline")}
                            </span>
                              <span className="font-medium text-blue-600">
                                {t("chart.negativeIsDrop")}
                              </span>
                            </div>
                              <span className="tabular-nums text-zinc-500">
                                {t("chart.visibleCount", {
                                  shown: visibleItems.length,
                                  total: filteredItems.length,
                                })}
                              </span>
                            </div>

                            <div className="relative">
                              <svg
                                viewBox={`0 0 ${width} ${height}`}
                                role="img"
                                aria-label={t("chart.ariaChartLabel")}
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

                                {/* Series lines and area layer */}
                                {orderedTrajectories.map(({ item, seriesColor, points }) => {
                                  const isPrimary = item.item_id === primaryItemId;
                                  const isDimmed = hoveredItemId !== null && !isPrimary;
                                  const polyline = points
                                    .map((p) => `${p.rawX},${p.lineY}`)
                                    .join(" ");
                                  const firstPt = points[0];
                                  const lastPt = points[points.length - 1];

                                  return (
                                    <g key={item.item_id} opacity={isDimmed ? 0.25 : 1}>
                                      {isPrimary && points.length > 1 && (
                                        <polygon
                                          points={`${polyline} ${lastPt.rawX},${plotBottomY} ${firstPt.rawX},${plotBottomY}`}
                                          fill="url(#cobaltArea)"
                                        />
                                      )}
                                      {points.length === 1 ? (
                                        <line
                                          x1={Math.max(padX, points[0].rawX - 36)}
                                          y1={points[0].lineY}
                                          x2={points[0].rawX}
                                          y2={points[0].lineY}
                                          stroke={seriesColor}
                                          strokeWidth={isPrimary ? "2.25" : "1.75"}
                                          strokeDasharray="4 3"
                                          strokeLinecap="round"
                                        />
                                      ) : (
                                        <polyline
                                          fill="none"
                                          stroke={seriesColor}
                                          strokeWidth={isPrimary ? "2.25" : "1.75"}
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          points={polyline}
                                        />
                                      )}
                                      {isPrimary && lastPt && (
                                        <circle
                                          cx={lastPt.cx}
                                          cy={lastPt.cy}
                                          r={8}
                                          fill={seriesColor}
                                          fillOpacity="0.2"
                                        />
                                      )}
                                    </g>
                                  );
                                })}

                                {/* Top interactive bullets layer */}
                                <g data-chart-bullets="true">
                                  {allBullets.map((pt) => {
                                    const isPrimary = pt.itemId === primaryItemId;
                                    const isDimmed = hoveredItemId !== null && !isPrimary;
                                    const isActiveBullet =
                                      hoveredPoint?.historyId === pt.historyId;
                                    const activatePoint = () => {
                                      setHoveredItemId(pt.itemId);
                                      setHoveredPoint({
                                        historyId: pt.historyId,
                                        itemId: pt.itemId,
                                        itemName: pt.itemName,
                                        seriesColor: pt.seriesColor,
                                        tagNames: pt.tagNames,
                                        recordedAt: pt.recordedAt,
                                        formattedTime: pt.formattedTime,
                                        priceText: pt.priceText,
                                        baselineText: pt.baselineText,
                                        deltaPct: pt.trueDeltaPct,
                                        checkIndex: pt.checkIndex,
                                        totalChecks: pt.totalChecks,
                                        eventType: pt.eventType,
                                        x: pt.cx,
                                        y: pt.cy,
                                      });
                                    };
                                    const handleSelectPoint = () => {
                                      clearHover();
                                      onOpenItem?.(pt.itemId);
                                    };
                                    return (
                                      <circle
                                        key={pt.historyId}
                                        data-chart-bullet="true"
                                        data-item-id={pt.itemId}
                                        data-history-id={pt.historyId}
                                        cx={pt.cx}
                                        cy={pt.cy}
                                        r={isActiveBullet ? 5 : isPrimary ? 4 : 3}
                                        fill={pt.seriesColor}
                                        stroke="#FFFFFF"
                                        strokeWidth="1.5"
                                        opacity={isDimmed ? 0.25 : 1}
                                        tabIndex={onOpenItem ? 0 : undefined}
                                        aria-label={
                                          onOpenItem
                                            ? `${pt.itemName} (${pt.priceText})`
                                            : undefined
                                        }
                                        className="cursor-pointer focus:outline-none"
                                        onMouseEnter={activatePoint}
                                        onMouseLeave={clearHover}
                                        onFocus={activatePoint}
                                        onBlur={clearHover}
                                        onClick={
                                          onOpenItem
                                            ? handleSelectPoint
                                            : activatePoint
                                        }
                                        onKeyDown={(e) => {
                                          if (
                                            onOpenItem &&
                                            (e.key === "Enter" ||
                                              e.key === " ")
                                          ) {
                                            e.preventDefault();
                                            handleSelectPoint();
                                          }
                                        }}
                                      />
                                    );
                                  })}
                                </g>
                              </svg>

                              {hoveredPoint && (
                                <div
                                  role="status"
                                  style={{
                                    left: `clamp(8px, calc(${(hoveredPoint.x / width) * 100}% - 120px), calc(100% - 250px))`,
                                    ...(hoveredPoint.y < 95
                                      ? {
                                          top: `calc(${(hoveredPoint.y / height) * 100}% + 12px)`,
                                        }
                                      : {
                                          bottom: `calc(${((height - hoveredPoint.y) / height) * 100}% + 12px)`,
                                        }),
                                  }}
                                  className="pointer-events-none absolute z-10 w-[min(242px,calc(100%-16px))] rounded-lg border border-gray-200 bg-white/95 px-3 py-2 text-[11px] leading-snug shadow-lg backdrop-blur-[2px]"
                                >
                                  <div className="flex items-start gap-1.5 font-semibold text-zinc-950">
                                    <span
                                      aria-hidden="true"
                                      style={{
                                        backgroundColor: hoveredPoint.seriesColor,
                                      }}
                                      className="mt-1 h-2 w-2 shrink-0 rounded-full"
                                    />
                                    <span className="line-clamp-2">
                                      {hoveredPoint.itemName}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-zinc-500">
                                    {t("chart.tagsLabel")}: {hoveredPoint.tagNames}{" "}
                                    &bull;{" "}
                                    {t("chart.pointLabel", {
                                      index: hoveredPoint.checkIndex,
                                      total: hoveredPoint.totalChecks,
                                    })}{" "}
                                    ({hoveredPoint.eventType})
                                  </div>
                                  <div className="tabular-nums mt-0.5 font-medium text-blue-600">
                                    {hoveredPoint.priceText} (
                                    {hoveredPoint.deltaPct > 0 ? "+" : ""}
                                    {hoveredPoint.deltaPct}%{" "}
                                    {t("chart.vsBaseline", {
                                      baseline: hoveredPoint.baselineText,
                                    })}
                                    )
                                  </div>
                                  <div className="tabular-nums mt-0.5 text-[10px] text-zinc-400">
                                    {hoveredPoint.formattedTime}
                                  </div>
                                </div>
                              )}
                            </div>

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
              {t("chart.seriesFilters", {
                shown: visibleItems.length,
                total: filteredItems.length,
              })}
            </span>
            <span className="text-zinc-600">
              {mobileControlsOpen
                ? t("chart.hideControls")
                : t("chart.showControls")}
            </span>
          </button>

          <aside
            id={ANCHORS.chartPanelControls}
            aria-label={t("chart.seriesControlsAria")}
            className={`${
              mobileControlsOpen ? "flex" : "hidden"
            } min-w-0 w-full flex-col gap-2.5 rounded-xl border border-gray-200 bg-gray-50/50 p-3 lg:flex lg:rounded-none lg:border-0 lg:border-l lg:border-gray-100 lg:bg-transparent lg:p-0 lg:pl-4`}
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="tabular-nums truncate text-xs font-semibold text-zinc-950">
                {t("chart.seriesVisible", {
                  shown: visibleItems.length,
                  total: filteredItems.length,
                })}
              </span>
              <button
                type="button"
                onClick={toggleAll}
                className="min-h-11 shrink-0 px-1 text-[11px] font-medium text-zinc-600 hover:text-zinc-950 sm:min-h-8"
              >
                {allSelected ? t("chart.unselectAll") : t("chart.selectAll")}
              </button>
            </div>

            <label htmlFor={ANCHORS.chartCategoryFilter} className="sr-only">
              {t("chart.filterByTag")}
            </label>
            <select
              id={ANCHORS.chartCategoryFilter}
              aria-label={t("chart.filterByTag")}
              value={activeTagFilter}
              onChange={(e) => {
                clearHover();
                onTagFilterChange(e.target.value);
              }}
              className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-zinc-950 focus:outline-none focus:ring-1 focus:ring-zinc-950 sm:min-h-9"
            >
              <option value="ALL">
                {t("chart.allTags", { count: tags.length })}
              </option>
              {tags.map((tag) => (
                <option key={tag.tag_id} value={tag.tag_id}>
                  {tag.name}
                </option>
              ))}
            </select>

            <label htmlFor="chart-series-search" className="sr-only">
              {t("chart.filterSeriesPlaceholder")}
            </label>
            <input
              id="chart-series-search"
              type="search"
              value={searchQuery}
              onChange={(e) => {
                clearHover();
                setSearchQuery(e.target.value);
              }}
              placeholder={t("chart.filterSeriesPlaceholder")}
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
                        onFocus={() => {
                          if (checked) setHoveredItemId(item.item_id);
                        }}
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
