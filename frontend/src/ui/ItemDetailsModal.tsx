import { useEffect, useRef, useState } from "react";
import type {
  BoughtItem,
  PriceSnapshot,
  Tag,
  TrackedItem,
  UpdateItemPayload,
} from "../domain/models";
import { formatMoney } from "../domain/models";
import { ANCHORS } from "../shared/anchors";
import { useBottomSheetSwipeDismiss } from "../shared/useBottomSheetSwipeDismiss";
import { TagAdderControl } from "./TagAdderControl";
import type { PushToastFn } from "./ToastViewport";

interface ItemDetailsModalProps {
  activeItem: TrackedItem | null;
  boughtItem: BoughtItem | null;
  tags: Tag[];
  snapshots: PriceSnapshot[];
  onClose: () => void;
  onUpdateItem: (itemId: string, payload: UpdateItemPayload) => Promise<void>;
  onRecheckItem?: (itemId: string) => Promise<void>;
  onBuyItem: (itemId: string, purchasedPrice: number) => Promise<void>;
  onResumeItem: (itemId: string) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
  onNotify?: PushToastFn;
}

export function ItemDetailsModal({
  activeItem,
  boughtItem,
  tags,
  snapshots,
  onClose,
  onUpdateItem,
  onRecheckItem,
  onBuyItem,
  onResumeItem,
  onDeleteItem,
  onNotify,
}: ItemDetailsModalProps) {
  const item = activeItem ?? boughtItem;
  const [title, setTitle] = useState(item?.name ?? "");
  const [currentPrice, setCurrentPrice] = useState(
    activeItem ? String(activeItem.current_price) : "",
  );
  const [targetPrice, setTargetPrice] = useState(
    activeItem ? String(activeItem.target_price) : "",
  );
  const [buyPrice, setBuyPrice] = useState(
    activeItem ? String(activeItem.current_price) : "",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingActionLabel, setPendingActionLabel] = useState<string | null>(
    null,
  );
  const isBusy = pendingActionLabel !== null;
  const [hoveredSnap, setHoveredSnap] = useState<{
    historyId: string;
    priceText: string;
    deltaPct: number;
    formattedTime: string;
    eventType: string;
    index: number;
    total: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    setTitle(item?.name ?? "");
    setCurrentPrice(activeItem ? String(activeItem.current_price) : "");
    setTargetPrice(activeItem ? String(activeItem.target_price) : "");
    setBuyPrice(activeItem ? String(activeItem.current_price) : "");
    setConfirmDelete(false);
    setPendingActionLabel(null);
    setHoveredSnap(null);
  }, [item?.item_id, item?.name, activeItem]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const swipeHandleRef = useRef<HTMLDivElement>(null);
  const isOpen = Boolean(item);

  useBottomSheetSwipeDismiss({
    sheetRef: dialogRef,
    handleRef: swipeHandleRef,
    isOpen,
    onClose,
    disabled: isBusy,
  });

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (isBusy) return;
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isBusy) return;
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, isBusy]);

  if (!item) return null;

  const tagById = new Map(tags.map((t) => [t.tag_id, t]));
  const currentTagNames = item.tag_ids
    .map((id) => tagById.get(id)?.name)
    .filter((n): n is string => Boolean(n));

  const runBlockingAction = async (
    label: string,
    action: () => Promise<void>,
  ) => {
    if (isBusy) return;
    setPendingActionLabel(label);
    try {
      await action();
    } finally {
      setPendingActionLabel(null);
    }
  };

  const handleAddTag = async (tagName: string) => {
    const clean = tagName.trim();
    if (!clean || !activeItem) return;
    if (
      currentTagNames.some((n) => n.toLowerCase() === clean.toLowerCase())
    ) {
      return;
    }
    const nextNames = [...currentTagNames, clean];
    await runBlockingAction("Updating tags...", () =>
      onUpdateItem(activeItem.item_id, { tag_names: nextNames }),
    );
  };

  const handleRemoveTag = async (tagName: string) => {
    if (!activeItem) return;
    await runBlockingAction("Updating tags...", () =>
      onUpdateItem(activeItem.item_id, {
        tag_names: currentTagNames.filter((n) => n !== tagName),
      }),
    );
  };

  const handleSaveDetails = async () => {
    if (!activeItem) return;
    const parsedCurrent = Number(currentPrice);
    await runBlockingAction("Saving changes...", async () => {
      await onUpdateItem(activeItem.item_id, {
        name: title.trim() || activeItem.name,
        target_price: Number(targetPrice) || activeItem.target_price,
        ...(Number.isFinite(parsedCurrent) && parsedCurrent > 0
          ? { current_price: parsedCurrent }
          : {}),
      });
      onClose();
    });
  };

  const sortedSnaps = [...snapshots].sort((a, b) =>
    a.recorded_at.localeCompare(b.recorded_at),
  );
  const currentOrBoughtPrice = activeItem
    ? activeItem.current_price
    : (boughtItem?.purchased_price ?? item.initial_price);
  const numericTarget = activeItem
    ? Number(targetPrice) || activeItem.target_price
    : null;
  const allChartValues = [
    ...sortedSnaps.map((s) => s.price),
    currentOrBoughtPrice,
    ...(numericTarget !== null ? [numericTarget] : []),
  ];
  const rawMin = Math.min(...allChartValues);
  const rawMax = Math.max(...allChartValues);
  const padding = Math.max(1, (rawMax - rawMin) * 0.15);
  const minP = rawMin - padding;
  const maxP = rawMax + padding;
  const span = Math.max(1, maxP - minP);

  const chartW = 560;
  const chartH = 140;
  const padX = 24;
  const padY = 18;
  const plotBottomY = chartH - padY;
  const toY = (val: number) =>
    padY + ((maxP - val) / span) * (chartH - padY * 2);

  const formatSnapshotTimestamp = (iso: string) => {
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
  };

  const formatLastChecked = (iso: string) => {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return iso;
    const diffMins = Math.max(0, Math.round((Date.now() - ms) / 60000));
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.round(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.round(diffHours / 24)}d ago`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div
        id={ANCHORS.modalItemDetails}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={isBusy}
        aria-labelledby="item-details-title"
        className="relative max-h-[92dvh] w-full max-w-2xl overflow-hidden rounded-t-[20px] border border-gray-200 bg-white text-zinc-950 shadow-xl sm:rounded-2xl"
      >
        {isBusy && (
          <div
            id={ANCHORS.modalItemDetailsLoadingOverlay}
            aria-live="polite"
            className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 rounded-t-[20px] bg-white/80 p-6 text-center backdrop-blur-[2px] sm:rounded-2xl"
          >
            <div
              aria-hidden="true"
              className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-950"
            />
            <div className="text-xs font-semibold text-zinc-950">
              {pendingActionLabel}
            </div>
            <div className="text-[11px] text-zinc-500">
              Waiting for server response
            </div>
          </div>
        )}
        <div className="max-h-[92dvh] overflow-y-auto p-4 sm:p-6">
        <div
          ref={swipeHandleRef}
          data-swipe-handle="true"
          className="touch-none sm:touch-auto"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1 w-9 rounded-full bg-zinc-300 sm:hidden"
          />

          <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3.5">
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl border border-gray-200 bg-gray-100 object-cover"
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-xl border border-gray-200 bg-gray-100" />
              )}
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  {activeItem ? (
                    activeItem.status === "DISCOUNT" ? (
                      <span className="tabular-nums rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                        -{activeItem.drop_pct}% DISCOUNT
                      </span>
                    ) : (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-950">
                        ACTIVE
                      </span>
                    )
                  ) : (
                    boughtItem && (
                      <span className="tabular-nums rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-950">
                        BOUGHT (+{formatMoney(boughtItem.currency, boughtItem.saved_cost)})
                      </span>
                    )
                  )}
                  <span className="tabular-nums text-[11px] text-zinc-500">
                    {activeItem
                      ? `Last checked: ${formatLastChecked(activeItem.last_checked)}`
                      : boughtItem
                        ? `Bought: ${boughtItem.purchased_date}`
                        : ""}
                  </span>
                </div>
                <h2
                  id="item-details-title"
                  className="text-[15px] font-semibold leading-snug text-zinc-950"
                >
                  {item.name}
                </h2>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                >
                  Open Original Retailer Web Page &#x2197;
                </a>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <button
                type="button"
                disabled={isBusy}
                aria-label="Close Item Details modal"
                onClick={onClose}
                className="min-h-11 min-w-11 shrink-0 rounded-lg px-2 py-1 text-lg text-zinc-500 hover:bg-gray-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 sm:min-w-9"
              >
                &times;
              </button>
              {activeItem && onRecheckItem && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    void runBlockingAction("Re-checking price...", () =>
                      onRecheckItem(activeItem.item_id),
                    ).catch(() => undefined)
                  }
                  className="min-h-11 shrink-0 whitespace-nowrap rounded-xl bg-gray-100 px-3.5 py-2 text-xs font-medium text-zinc-950 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                >
                  Re-check
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 text-xs">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white p-3.5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
                  <span
                    aria-hidden="true"
                    className="inline-block w-3 border-t-2 border-blue-600"
                  />
                  Price Dynamics
                </span>
                {numericTarget !== null && (
                  <span className="inline-flex items-center gap-1.5 text-zinc-500">
                    <span
                      aria-hidden="true"
                      className="inline-block w-3 border-t-2 border-dashed border-zinc-400"
                    />
                    Target Threshold
                  </span>
                )}
              </div>
              <span className="tabular-nums font-semibold text-zinc-950">
                Value: {formatMoney(item.currency, currentOrBoughtPrice)}
              </span>
            </div>

            <div className="relative">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                role="img"
                aria-label="Item price history"
                className="h-28 w-full sm:h-32"
              >
                <defs>
                  <linearGradient id="modalCobaltArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity="0.14" />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {[0.2, 0.5, 0.8].map((frac) => (
                  <line
                    key={frac}
                    x1={padX}
                    y1={padY + frac * (chartH - padY * 2)}
                    x2={chartW - padX}
                    y2={padY + frac * (chartH - padY * 2)}
                    stroke="#F3F4F6"
                  />
                ))}

                {numericTarget !== null && (
                  <g>
                    <line
                      x1={padX}
                      y1={toY(numericTarget)}
                      x2={chartW - padX}
                      y2={toY(numericTarget)}
                      stroke="#A1A1AA"
                      strokeWidth="1.25"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={chartW - padX}
                      y={Math.max(12, toY(numericTarget) - 5)}
                      textAnchor="end"
                      fill="#71717A"
                      fontSize="10"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      Target: {formatMoney(item.currency, numericTarget)}
                    </text>
                  </g>
                )}

                {sortedSnaps.length > 0 &&
                  (() => {
                    const pts = sortedSnaps.map((s, idx) => {
                      const trueDeltaPct =
                        item.initial_price > 0
                          ? Math.round(
                            ((s.price - item.initial_price) / item.initial_price) *
                            1000,
                          ) / 10
                          : s.delta_pct;
                      return {
                        x:
                          sortedSnaps.length > 1
                            ? padX +
                            (idx / (sortedSnaps.length - 1)) * (chartW - padX * 2)
                            : chartW - padX,
                        y: toY(s.price),
                        id: s.history_id,
                        snap: s,
                        index: idx + 1,
                        trueDeltaPct,
                      };
                    });
                    const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
                    const firstPt = pts[0];
                    const lastPt = pts[pts.length - 1];
                    return (
                      <g>
                        {pts.length > 1 && (
                          <polygon
                            points={`${polyline} ${lastPt.x},${plotBottomY} ${firstPt.x},${plotBottomY}`}
                            fill="url(#modalCobaltArea)"
                          />
                        )}
                        {pts.length === 1 ? (
                          <line
                            x1={padX}
                            y1={pts[0].y}
                            x2={pts[0].x}
                            y2={pts[0].y}
                            stroke="#2563EB"
                            strokeWidth="2"
                            strokeDasharray="4 3"
                          />
                        ) : (
                          <polyline
                            fill="none"
                            stroke="#2563EB"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={polyline}
                          />
                        )}
                        {pts.map((p) => {
                          const activateSnap = () =>
                            setHoveredSnap({
                              historyId: p.id,
                              priceText: formatMoney(item.currency, p.snap.price),
                              deltaPct: p.trueDeltaPct,
                              formattedTime: formatSnapshotTimestamp(
                                p.snap.recorded_at,
                              ),
                              eventType: p.snap.event_type,
                              index: p.index,
                              total: pts.length,
                              x: p.x,
                              y: p.y,
                            });
                          return (
                            <circle
                              key={p.id}
                              cx={p.x}
                              cy={p.y}
                              r={hoveredSnap?.historyId === p.id ? 5 : 4}
                              fill="#2563EB"
                              stroke="#FFFFFF"
                              strokeWidth="1.5"
                              className="cursor-pointer"
                              onMouseEnter={activateSnap}
                              onMouseLeave={() => setHoveredSnap(null)}
                              onClick={activateSnap}
                            />
                          );
                        })}
                      </g>
                    );
                  })()}
              </svg>

              {hoveredSnap && (
                <div
                  role="status"
                  style={{
                    left: `clamp(8px, calc(${(hoveredSnap.x / chartW) * 100}% - 95px), calc(100% - 198px))`,
                    ...(hoveredSnap.y < 60
                      ? {
                        top: `calc(${(hoveredSnap.y / chartH) * 100}% + 10px)`,
                      }
                      : {
                        bottom: `calc(${((chartH - hoveredSnap.y) / chartH) * 100}% + 10px)`,
                      }),
                  }}
                  className="pointer-events-none absolute z-10 w-[min(190px,calc(100%-16px))] rounded-lg border border-gray-200 bg-white/95 px-2.5 py-1.5 text-[11px] leading-snug shadow-md"
                >
                  <div className="font-semibold text-zinc-950">
                    Point {hoveredSnap.index}/{hoveredSnap.total} (
                    {hoveredSnap.eventType})
                  </div>
                  <div className="tabular-nums font-medium text-blue-600">
                    {hoveredSnap.priceText} (
                    {hoveredSnap.deltaPct > 0 ? "+" : ""}
                    {hoveredSnap.deltaPct}% vs baseline)
                  </div>
                  <div className="tabular-nums text-[10px] text-zinc-400">
                    {hoveredSnap.formattedTime}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="divide-y divide-gray-200 border-t border-b border-gray-200">
            <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
              <span className="w-24 shrink-0 pt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Tags
              </span>
              <div className="min-w-0 flex-1">
                <TagAdderControl
                  key={item.item_id}
                  idPrefix="detail-add-tag"
                  availableTags={tags}
                  selectedTagNames={currentTagNames}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                  readOnly={!activeItem}
                />
              </div>
            </div>

            {activeItem ? (
              <>
                <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <label
                    htmlFor="detail-title"
                    className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Title
                  </label>
                  <input
                    id="detail-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-9"
                  />
                </div>

                <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:pt-2">
                    Pricing
                  </span>
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div className="min-w-0">
                      <div className="mb-1 text-[10px] font-medium text-zinc-500">
                        Baseline Price
                      </div>
                      <div className="tabular-nums flex min-h-11 items-center rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs font-medium text-zinc-700 sm:min-h-9">
                        {formatMoney(activeItem.currency, activeItem.initial_price)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label
                        htmlFor="detail-current-price"
                        className="mb-1 block text-[10px] font-medium text-zinc-500"
                      >
                        Current Tracked Price
                      </label>
                      <div className="flex min-h-11 items-center rounded-lg border border-gray-200 bg-white px-2.5 focus-within:ring-2 focus-within:ring-zinc-950 sm:min-h-9">
                        <span className="mr-1 text-zinc-400">
                          {activeItem.currency}
                        </span>
                        <input
                          id="detail-current-price"
                          type="number"
                          step="0.01"
                          value={currentPrice}
                          onChange={(e) => setCurrentPrice(e.target.value)}
                          className="tabular-nums min-w-0 w-full bg-transparent py-1.5 text-xs font-semibold text-zinc-950 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label
                        htmlFor="detail-target"
                        className="mb-1 block text-[10px] font-medium text-zinc-500"
                      >
                        Alert Target Price
                      </label>
                      <div className="flex min-h-11 items-center rounded-lg border border-gray-200 bg-white px-2.5 focus-within:ring-2 focus-within:ring-zinc-950 sm:min-h-9">
                        <span className="mr-1 text-zinc-400">
                          {activeItem.currency}
                        </span>
                        <input
                          id="detail-target"
                          type="number"
                          step="0.01"
                          value={targetPrice}
                          onChange={(e) => setTargetPrice(e.target.value)}
                          className="tabular-nums min-w-0 w-full bg-transparent py-1.5 text-xs font-medium text-zinc-950 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              boughtItem && (
                <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:pt-1">
                    Settlement
                  </span>
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-3">
                    <div>
                      <div className="text-[10px] font-medium text-zinc-500">
                        Baseline
                      </div>
                      <div className="tabular-nums font-medium text-zinc-700">
                        {formatMoney(boughtItem.currency, boughtItem.initial_price)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-zinc-500">
                        Bought Price
                      </div>
                      <div className="tabular-nums font-semibold text-zinc-950">
                        {formatMoney(
                          boughtItem.currency,
                          boughtItem.purchased_price,
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-zinc-500">
                        Realized Savings
                      </div>
                      <div className="tabular-nums font-semibold text-zinc-950">
                        +{formatMoney(boughtItem.currency, boughtItem.saved_cost)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}
          </div>

          {activeItem && (
            <div className="flex flex-col gap-3 rounded-xl bg-gray-100 p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-950">
                  Bought this item? Move to Bought Items Sheet
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  Stops active scraper tracking and logs savings to{" "}
                  <span className="font-medium text-zinc-950">Bought_Items</span>.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label htmlFor="detail-buy-price" className="sr-only">
                  Purchase Price
                </label>
                <div className="flex min-h-11 items-center rounded-lg border border-gray-200 bg-white px-2.5 sm:min-h-9">
                  <span className="mr-1 text-zinc-400">
                    {activeItem.currency}
                  </span>
                  <input
                    id="detail-buy-price"
                    type="number"
                    step="0.01"
                    value={buyPrice}
                    onChange={(e) => setBuyPrice(e.target.value)}
                    className="tabular-nums w-20 bg-transparent py-1.5 text-xs font-semibold text-zinc-950 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() =>
                    void runBlockingAction("Archiving as bought...", async () => {
                      await onBuyItem(
                        activeItem.item_id,
                        Number(buyPrice) || activeItem.current_price,
                      );
                      onClose();
                    })
                  }
                  className="min-h-11 rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                >
                  Confirm Buy
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 text-xs">
          <div>
            {!confirmDelete ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setConfirmDelete(true);
                  onNotify?.(
                    "warning",
                    "Confirm deletion",
                    "Click Confirm Delete to permanently remove this position.",
                  );
                }}
                className="min-h-11 rounded-lg bg-red-50 px-3 py-1.5 font-medium text-red-600 hover:bg-red-100 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
              >
                Delete Position
              </button>
            ) : (
              <button
                type="button"
                disabled={isBusy}
                onClick={() =>
                  void runBlockingAction("Deleting position...", async () => {
                    await onDeleteItem(item.item_id);
                    onClose();
                  })
                }
                className="min-h-11 rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
              >
                Confirm Delete
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={onClose}
              className="min-h-11 rounded-lg bg-gray-100 px-4 py-1.5 font-medium text-zinc-950 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
            >
              Close
            </button>
            {activeItem ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleSaveDetails()}
                className="min-h-11 rounded-lg bg-zinc-950 px-5 py-1.5 font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
              >
                Save Changes
              </button>
            ) : (
              <button
                type="button"
                disabled={isBusy}
                onClick={() =>
                  void runBlockingAction("Resuming tracking...", async () => {
                    await onResumeItem(item.item_id);
                    onClose();
                  })
                }
                className="min-h-11 rounded-lg bg-zinc-950 px-5 py-1.5 font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
              >
                Resume Tracking
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
