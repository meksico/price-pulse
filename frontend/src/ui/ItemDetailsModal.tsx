import { useEffect, useState } from "react";
import type {
  BoughtItem,
  PriceSnapshot,
  Tag,
  TrackedItem,
  UpdateItemPayload,
} from "../domain/models";
import { TAG_BADGE_CLASSES, formatMoney } from "../domain/models";
import { ANCHORS } from "../shared/anchors";

interface ItemDetailsModalProps {
  activeItem: TrackedItem | null;
  boughtItem: BoughtItem | null;
  tags: Tag[];
  snapshots: PriceSnapshot[];
  onClose: () => void;
  onUpdateItem: (itemId: string, payload: UpdateItemPayload) => Promise<void>;
  onBuyItem: (itemId: string, purchasedPrice: number) => Promise<void>;
  onResumeItem: (itemId: string) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
}

export function ItemDetailsModal({
  activeItem,
  boughtItem,
  tags,
  snapshots,
  onClose,
  onUpdateItem,
  onBuyItem,
  onResumeItem,
  onDeleteItem,
}: ItemDetailsModalProps) {
  const item = activeItem ?? boughtItem;
  const [title, setTitle] = useState(item?.name ?? "");
  const [targetPrice, setTargetPrice] = useState(
    activeItem ? String(activeItem.target_price) : "",
  );
  const [buyPrice, setBuyPrice] = useState(
    activeItem ? String(activeItem.current_price) : "",
  );
  const [newTag, setNewTag] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(item?.name ?? "");
    setTargetPrice(activeItem ? String(activeItem.target_price) : "");
    setBuyPrice(activeItem ? String(activeItem.current_price) : "");
    setConfirmDelete(false);
  }, [item?.item_id, item?.name, activeItem]);

  if (!item) return null;

  const tagById = new Map(tags.map((t) => [t.tag_id, t]));
  const currentTagNames = item.tag_ids
    .map((id) => tagById.get(id)?.name)
    .filter((n): n is string => Boolean(n));

  const handleAddTag = async () => {
    const clean = newTag.trim();
    if (!clean || !activeItem) return;
    const nextNames = Array.from(new Set([...currentTagNames, clean]));
    await onUpdateItem(activeItem.item_id, { tag_names: nextNames });
    setNewTag("");
  };

  const handleRemoveTag = async (tagName: string) => {
    if (!activeItem) return;
    await onUpdateItem(activeItem.item_id, {
      tag_names: currentTagNames.filter((n) => n !== tagName),
    });
  };

  const handleSaveDetails = async () => {
    if (!activeItem) return;
    await onUpdateItem(activeItem.item_id, {
      name: title.trim() || activeItem.name,
      target_price: Number(targetPrice) || activeItem.target_price,
    });
    onClose();
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
  const toY = (val: number) =>
    padY + ((maxP - val) / span) * (chartH - padY * 2);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-4">
      <div
        id={ANCHORS.modalItemDetails}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-details-title"
        className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl sm:p-5"
      >
        <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {item.image_url ? (
              <img
                src={item.image_url}
                alt=""
                className="h-12 w-12 shrink-0 rounded-xl bg-slate-800 object-cover"
              />
            ) : (
              <div className="h-12 w-12 shrink-0 rounded-xl bg-slate-800" />
            )}
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {activeItem ? (
                  activeItem.status === "DISCOUNT" ? (
                    <span className="rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-950">
                      -{activeItem.drop_pct}% DISCOUNT
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                      ACTIVE
                    </span>
                  )
                ) : (
                  boughtItem && (
                    <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                      BOUGHT (+{formatMoney(boughtItem.currency, boughtItem.saved_cost)})
                    </span>
                  )
                )}
              </div>
              <h2
                id="item-details-title"
                className="text-base font-semibold leading-snug text-slate-100"
              >
                {item.name}
              </h2>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close Item Details modal"
            onClick={onClose}
            className="min-h-11 min-w-11 shrink-0 rounded-lg px-2 py-1 text-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 sm:min-h-9 sm:min-w-9"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/75 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 text-slate-300">
                  <span
                    aria-hidden="true"
                    className="inline-block w-3 border-t-2 border-emerald-400"
                  />
                  Price Dynamics
                </span>
                {numericTarget !== null && (
                  <span className="inline-flex items-center gap-1.5 text-slate-300">
                    <span
                      aria-hidden="true"
                      className="inline-block w-3 border-t-2 border-dashed border-rose-400"
                    />
                    Target Threshold
                  </span>
                )}
              </div>
              <span className="font-semibold text-emerald-400">
                Value: {formatMoney(item.currency, currentOrBoughtPrice)}
              </span>
            </div>

            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              role="img"
              aria-label="Item price history"
              className="h-32 w-full sm:h-36"
            >
              {[0.2, 0.5, 0.8].map((frac) => (
                <line
                  key={frac}
                  x1={padX}
                  y1={padY + frac * (chartH - padY * 2)}
                  x2={chartW - padX}
                  y2={padY + frac * (chartH - padY * 2)}
                  stroke="#1e293b"
                />
              ))}

              {numericTarget !== null && (
                <g>
                  <line
                    x1={padX}
                    y1={toY(numericTarget)}
                    x2={chartW - padX}
                    y2={toY(numericTarget)}
                    stroke="#f43f5e"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={chartW - padX}
                    y={Math.max(12, toY(numericTarget) - 5)}
                    textAnchor="end"
                    fill="#fb7185"
                    fontSize="10"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    Target: {formatMoney(item.currency, numericTarget)}
                  </text>
                </g>
              )}

              {sortedSnaps.length > 0 && (() => {
                const pts = sortedSnaps.map((s, idx) => ({
                  x:
                    sortedSnaps.length > 1
                      ? padX + (idx / (sortedSnaps.length - 1)) * (chartW - padX * 2)
                      : chartW - padX,
                  y: toY(s.price),
                  id: s.history_id,
                }));
                return (
                  <g>
                    {pts.length === 1 ? (
                      <line
                        x1={padX}
                        y1={pts[0].y}
                        x2={pts[0].x}
                        y2={pts[0].y}
                        stroke="#10b981"
                        strokeWidth="2.5"
                        strokeDasharray="4 3"
                      />
                    ) : (
                      <polyline
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                      />
                    )}
                    {pts.map((p) => (
                      <circle
                        key={p.id}
                        cx={p.x}
                        cy={p.y}
                        r={4}
                        fill="#10b981"
                        stroke="#020617"
                        strokeWidth="1.5"
                      />
                    ))}
                  </g>
                );
              })()}
            </svg>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Assigned Tags
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {item.tag_ids.length === 0 && (
                <span className="text-slate-500">No tags assigned</span>
              )}
              {item.tag_ids.map((tid) => {
                const tag = tagById.get(tid);
                if (!tag) return null;
                return (
                  <span
                    key={tid}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] ${
                      TAG_BADGE_CLASSES[tag.color]
                    }`}
                  >
                    {tag.name}
                    {activeItem && (
                      <button
                        type="button"
                        aria-label={`Remove tag ${tag.name}`}
                        onClick={() => void handleRemoveTag(tag.name)}
                        className="ml-0.5 hover:text-white"
                      >
                        &times;
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            {activeItem && (
              <div className="mt-2.5 flex gap-2">
                <label htmlFor="detail-add-tag" className="sr-only">
                  Add Tag
                </label>
                <input
                  id="detail-add-tag"
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAddTag();
                    }
                  }}
                  placeholder="Type tag name (e.g. Gift Idea, Amazon, Prime Day)..."
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 sm:min-h-9"
                />
                <button
                  type="button"
                  onClick={() => void handleAddTag()}
                  className="min-h-11 shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 sm:min-h-9"
                >
                  + Add Tag
                </button>
              </div>
            )}
          </div>

          {activeItem ? (
            <>
              <div>
                <label htmlFor="detail-title" className="mb-1 block text-slate-400">
                  Product Title
                </label>
                <input
                  id="detail-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-100 sm:min-h-9"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1 text-slate-400">Baseline Price</div>
                  <div className="flex min-h-11 items-center rounded-lg border border-slate-800 bg-slate-950/70 px-3 font-mono text-slate-200 sm:min-h-9">
                    {formatMoney(activeItem.currency, activeItem.initial_price)}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-slate-400">Current Tracked Price</div>
                  <div className="flex min-h-11 items-center rounded-lg border border-slate-800 bg-slate-950/70 px-3 font-mono font-semibold text-emerald-400 sm:min-h-9">
                    {formatMoney(activeItem.currency, activeItem.current_price)}
                  </div>
                </div>
                <div>
                  <label htmlFor="detail-target" className="mb-1 block text-slate-400">
                    Alert Target Price
                  </label>
                  <div className="flex min-h-11 items-center rounded-lg border border-slate-700 bg-slate-950 px-2.5 sm:min-h-9">
                    <span className="mr-1.5 font-mono text-slate-400">
                      {activeItem.currency}
                    </span>
                    <input
                      id="detail-target"
                      type="number"
                      step="0.01"
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(e.target.value)}
                      className="min-w-0 w-full bg-transparent py-1.5 font-mono text-rose-300 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-emerald-400 hover:underline"
                >
                  Open Original Retailer Web Page &nearr;
                </a>
                <span className="text-slate-400">
                  Last checked: {formatLastChecked(activeItem.last_checked)}
                </span>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold text-emerald-300">
                    Bought this item? Move to Bought Items Sheet
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    Stops active scraper tracking and writes record to the dedicated{" "}
                    <span className="text-emerald-300">Bought_Items</span> sheet.
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <label htmlFor="detail-buy-price" className="sr-only">
                    Purchase Price
                  </label>
                  <div className="flex min-h-11 items-center rounded-lg border border-slate-700 bg-slate-950 px-2.5 sm:min-h-9">
                    <span className="mr-1 font-mono text-slate-400">
                      {activeItem.currency}
                    </span>
                    <input
                      id="detail-buy-price"
                      type="number"
                      step="0.01"
                      value={buyPrice}
                      onChange={(e) => setBuyPrice(e.target.value)}
                      className="w-20 bg-transparent py-1.5 font-mono text-slate-100 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await onBuyItem(
                        activeItem.item_id,
                        Number(buyPrice) || activeItem.current_price,
                      );
                      onClose();
                    }}
                    className="min-h-11 rounded-lg bg-emerald-500 px-3.5 py-1.5 font-semibold text-slate-950 hover:bg-emerald-400 sm:min-h-9"
                  >
                    Confirm Buy
                  </button>
                </div>
              </div>
            </>
          ) : (
            boughtItem && (
              <>
                <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                  <div>
                    <div className="text-slate-400">Baseline</div>
                    <div className="font-mono text-slate-200">
                      {formatMoney(boughtItem.currency, boughtItem.initial_price)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Bought Price</div>
                    <div className="font-mono text-slate-100">
                      {formatMoney(boughtItem.currency, boughtItem.purchased_price)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Realized Savings</div>
                    <div className="font-mono font-semibold text-emerald-400">
                      +{formatMoney(boughtItem.currency, boughtItem.saved_cost)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-emerald-400 hover:underline"
                  >
                    Open Original Retailer Web Page &nearr;
                  </a>
                  <span className="text-slate-400">
                    Bought: {boughtItem.purchased_date}
                  </span>
                </div>
              </>
            )
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4 text-xs">
          <div>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="min-h-11 rounded-lg border border-rose-500/40 px-3 py-1.5 text-rose-300 hover:bg-rose-500/10 sm:min-h-9"
              >
                Delete Position
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await onDeleteItem(item.item_id);
                  onClose();
                }}
                className="min-h-11 rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-500 sm:min-h-9"
              >
                Confirm Delete
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800 sm:min-h-9"
            >
              Close
            </button>
            {activeItem ? (
              <button
                type="button"
                onClick={() => void handleSaveDetails()}
                className="min-h-11 rounded-lg bg-emerald-500 px-3.5 py-1.5 font-semibold text-slate-950 hover:bg-emerald-400 sm:min-h-9"
              >
                Save Changes
              </button>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  await onResumeItem(item.item_id);
                  onClose();
                }}
                className="min-h-11 rounded-lg bg-emerald-500 px-3.5 py-1.5 font-semibold text-slate-950 hover:bg-emerald-400 sm:min-h-9"
              >
                Resume Tracking
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

