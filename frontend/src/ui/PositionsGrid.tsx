import { useMemo, useState } from "react";
import type {
  BoughtItem,
  PriceSnapshot,
  Tag,
  TrackedItem,
} from "../domain/models";
import { TAG_BADGE_CLASSES, formatMoney } from "../domain/models";
import { ANCHORS } from "../shared/anchors";

type GridTab = "active" | "bought";
type GroupMode = "none" | "tag";
type SortField = "name" | "initial_price" | "current_price" | "target_price" | "drop_pct";

const PAGE_SIZE = 15;

interface PositionsGridProps {
  items: TrackedItem[];
  boughtItems: BoughtItem[];
  tags: Tag[];
  priceHistory: PriceSnapshot[];
  activeTab: GridTab;
  onTabChange: (tab: GridTab) => void;
  activeTagFilter: string;
  onTagFilterChange: (tagId: string) => void;
  onOpenItem: (itemId: string) => void;
  onOpenAddModal: () => void;
}

function Sparkline({ snapshots }: { snapshots: PriceSnapshot[] }) {
  if (snapshots.length < 2) {
    return <span className="text-xs text-slate-500">—</span>;
  }
  const prices = snapshots.map((s) => s.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(0.01, max - min);
  const pts = prices
    .map((p, idx) => {
      const x = (idx / (prices.length - 1)) * 60;
      const y = 18 - ((p - min) / span) * 14;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width="64" height="22" aria-hidden="true" className="inline-block">
      <polyline fill="none" stroke="#10b981" strokeWidth="1.5" points={pts} />
    </svg>
  );
}

export function PositionsGrid({
  items,
  boughtItems,
  tags,
  priceHistory,
  activeTab,
  onTabChange,
  activeTagFilter,
  onTagFilterChange,
  onOpenItem,
  onOpenAddModal,
}: PositionsGridProps) {
  const [groupBy, setGroupBy] = useState<GroupMode>("none");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("drop_pct");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const tagById = useMemo(
    () => new Map(tags.map((t) => [t.tag_id, t])),
    [tags],
  );

  const distinctActiveTags = useMemo(() => {
    const usedIds = new Set(items.flatMap((i) => i.tag_ids));
    return tags.filter((t) => usedIds.has(t.tag_id));
  }, [items, tags]);

  const handleTagChipClick = (tagId: string) => {
    setPage(1);
    onTagFilterChange(activeTagFilter === tagId ? "ALL" : tagId);
  };

  const filteredActive = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = items.filter((item) => {
      if (activeTagFilter !== "ALL" && !item.tag_ids.includes(activeTagFilter)) {
        return false;
      }
      if (!q) return true;
      const tagNames = item.tag_ids
        .map((id) => tagById.get(id)?.name ?? "")
        .join(" ")
        .toLowerCase();
      return item.name.toLowerCase().includes(q) || tagNames.includes(q);
    });
    return [...list].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sortAsc ? cmp : -cmp;
    });
  }, [items, activeTagFilter, searchQuery, sortField, sortAsc, tagById]);

  const filteredBought = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return boughtItems.filter((item) => {
      if (activeTagFilter !== "ALL" && !item.tag_ids.includes(activeTagFilter)) {
        return false;
      }
      if (!q) return true;
      const tagNames = item.tag_ids
        .map((id) => tagById.get(id)?.name ?? "")
        .join(" ")
        .toLowerCase();
      return item.name.toLowerCase().includes(q) || tagNames.includes(q);
    });
  }, [boughtItems, activeTagFilter, searchQuery, tagById]);

  const totalPages = Math.max(1, Math.ceil(filteredActive.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedActive =
    groupBy === "none"
      ? filteredActive.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
      : filteredActive;

  const groupedActive = useMemo(() => {
    if (groupBy !== "tag") return [];
    const groups = new Map<string, { label: string; rows: TrackedItem[] }>();
    for (const item of filteredActive) {
      if (item.tag_ids.length === 0) {
        const entry = groups.get("untagged") ?? { label: "Untagged", rows: [] };
        entry.rows.push(item);
        groups.set("untagged", entry);
        continue;
      }
      for (const tid of item.tag_ids) {
        const label = tagById.get(tid)?.name ?? "Unknown";
        const entry = groups.get(tid) ?? { label, rows: [] };
        entry.rows.push(item);
        groups.set(tid, entry);
      }
    }
    return Array.from(groups.entries());
  }, [groupBy, filteredActive, tagById]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc((p) => !p);
    else {
      setSortField(field);
      setSortAsc(field === "name");
    }
  };

  const renderTagChips = (tagIds: string[]) => (
    <div className="flex flex-wrap gap-1">
      {tagIds.map((tid) => {
        const tag = tagById.get(tid);
        if (!tag) return null;
        const active = activeTagFilter === tid;
        return (
          <button
            key={tid}
            type="button"
            onClick={() => handleTagChipClick(tid)}
            aria-pressed={active}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
              TAG_BADGE_CLASSES[tag.color]
            } ${active ? "ring-1 ring-emerald-400" : ""}`}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );

  const renderMobileActiveCard = (item: TrackedItem) => (
    <article
      key={item.item_id}
      className="min-w-0 space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {item.image_url ? (
            <img
              src={item.image_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-800" />
          )}
          <button
            type="button"
            onClick={() => onOpenItem(item.item_id)}
            title={item.name}
            className="line-clamp-2 text-left text-sm font-medium text-slate-100 hover:text-emerald-300"
          >
            {item.name}
          </button>
        </div>
        {item.status === "DISCOUNT" ? (
          <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
            -{item.drop_pct}%
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
            NORMAL
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800/80 bg-slate-900/60 p-2 text-xs">
        <div>
          <div className="text-[10px] text-slate-400">Baseline</div>
          <div className="font-mono text-slate-300">
            {formatMoney(item.currency, item.initial_price)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Current</div>
          <div
            className={`font-mono font-semibold ${
              item.status === "DISCOUNT" ? "text-emerald-400" : "text-slate-100"
            }`}
          >
            {formatMoney(item.currency, item.current_price)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Target</div>
          <div className="font-mono text-slate-300">
            {formatMoney(item.currency, item.target_price)}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">{renderTagChips(item.tag_ids)}</div>
        <button
          type="button"
          onClick={() => onOpenItem(item.item_id)}
          className="min-h-11 shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 sm:min-h-9"
        >
          Item Card &rarr;
        </button>
      </div>
    </article>
  );

  const renderMobileBoughtCard = (item: BoughtItem) => (
    <article
      key={item.item_id}
      className="min-w-0 space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenItem(item.item_id)}
          className="min-w-0 text-left text-sm font-medium text-slate-100 hover:text-emerald-300"
        >
          {item.name}
        </button>
        <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
          +{formatMoney(item.currency, item.saved_cost)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-800/80 bg-slate-900/60 p-2 text-xs">
        <div>
          <div className="text-[10px] text-slate-400">Baseline</div>
          <div className="font-mono text-slate-300">
            {formatMoney(item.currency, item.initial_price)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Bought</div>
          <div className="font-mono text-slate-100">
            {formatMoney(item.currency, item.purchased_price)}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-400">Date</div>
          <div className="text-slate-300">{item.purchased_date}</div>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 flex-1">{renderTagChips(item.tag_ids)}</div>
        <button
          type="button"
          onClick={() => onOpenItem(item.item_id)}
          className="min-h-11 shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 sm:min-h-9"
        >
          View Card
        </button>
      </div>
    </article>
  );

  const renderActiveRow = (item: TrackedItem) => {
    const snaps = priceHistory.filter((s) => s.item_id === item.item_id);
    return (
      <tr key={item.item_id} className="border-t border-slate-800/80 hover:bg-slate-800/30">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            {item.image_url ? (
              <img
                src={item.image_url}
                alt=""
                className="h-8 w-8 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="h-8 w-8 shrink-0 rounded-lg bg-slate-800" />
            )}
            <button
              type="button"
              onClick={() => onOpenItem(item.item_id)}
              title={item.name}
              className="max-w-xs truncate text-left font-medium text-slate-100 hover:text-emerald-300"
            >
              {item.name}
            </button>
          </div>
        </td>
        <td className="px-3 py-2.5">{renderTagChips(item.tag_ids)}</td>
        <td className="px-3 py-2.5 font-mono text-xs text-slate-400">
          {formatMoney(item.currency, item.initial_price)}
        </td>
        <td
          className={`px-3 py-2.5 font-mono text-xs font-semibold ${
            item.status === "DISCOUNT" ? "text-emerald-400" : "text-slate-100"
          }`}
        >
          {formatMoney(item.currency, item.current_price)}
        </td>
        <td className="px-3 py-2.5 font-mono text-xs text-slate-300">
          {formatMoney(item.currency, item.target_price)}
        </td>
        <td className="px-3 py-2.5">
          <Sparkline snapshots={snaps} />
        </td>
        <td className="px-3 py-2.5">
          {item.status === "DISCOUNT" ? (
            <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
              -{item.drop_pct}%
            </span>
          ) : (
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
              NORMAL
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right">
          <button
            type="button"
            onClick={() => onOpenItem(item.item_id)}
            className="whitespace-nowrap rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
          >
            Item Card &rarr;
          </button>
        </td>
      </tr>
    );
  };

  return (
    <section
      id={ANCHORS.gridPanel}
      aria-label="Tracked positions and bought items"
      className="@container min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4"
    >
      <div
        id={ANCHORS.gridPanelToolbar}
        className="mb-3 flex min-w-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between"
      >
        <div
          role="tablist"
          aria-label="Grid dataset view"
          className="grid min-w-0 grid-cols-2 gap-1.5 sm:flex sm:items-center sm:gap-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "active"}
            onClick={() => onTabChange("active")}
            className={`min-h-11 min-w-0 truncate rounded-lg px-2.5 py-1.5 text-xs font-semibold sm:min-h-9 sm:px-3 ${
              activeTab === "active"
                ? "bg-emerald-500/20 text-emerald-300"
                : "text-slate-400 hover:bg-slate-800"
            }`}
          >
            Active Positions ({items.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "bought"}
            onClick={() => onTabChange("bought")}
            className={`min-h-11 min-w-0 truncate rounded-lg px-2.5 py-1.5 text-xs font-semibold sm:min-h-9 sm:px-3 ${
              activeTab === "bought"
                ? "bg-emerald-500/20 text-emerald-300"
                : "text-slate-400 hover:bg-slate-800"
            }`}
          >
            Bought Items Sheet ({boughtItems.length})
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            {activeTab === "active" && (
              <>
                <label htmlFor="grid-group-by" className="shrink-0 text-xs text-slate-400">
                  Group By
                </label>
                <select
                  id="grid-group-by"
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupMode)}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 sm:min-h-9 sm:flex-none"
                >
                  <option value="none">Flat List (None)</option>
                  <option value="tag">Tag</option>
                </select>
              </>
            )}
            <button
              type="button"
              onClick={onOpenAddModal}
              className="min-h-11 shrink-0 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 sm:hidden"
            >
              + Add URL
            </button>
          </div>
          <label htmlFor="grid-search" className="sr-only">
            Search items or tags
          </label>
          <input
            id="grid-search"
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search products or tags..."
            className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 sm:min-h-9 sm:w-52"
          />
          <button
            type="button"
            onClick={onOpenAddModal}
            className="hidden min-h-9 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 sm:inline-block"
          >
            + Add URL
          </button>
        </div>
      </div>

      <div
        id={ANCHORS.gridPanelTagBar}
        data-scroll-container="true"
        className="mb-3 flex items-center gap-2 overflow-x-auto pb-1"
      >
        <span className="shrink-0 text-xs text-slate-400">Filter by Tag:</span>
        <button
          type="button"
          aria-pressed={activeTagFilter === "ALL"}
          onClick={() => {
            setPage(1);
            onTagFilterChange("ALL");
          }}
          className={`min-h-11 shrink-0 rounded-full border px-3 py-1 text-xs sm:min-h-8 sm:px-2.5 sm:py-0.5 ${
            activeTagFilter === "ALL"
              ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
              : "border-slate-700 text-slate-300 hover:bg-slate-800"
          }`}
        >
          Show All
        </button>
        {distinctActiveTags.map((tag) => (
          <button
            key={tag.tag_id}
            type="button"
            aria-pressed={activeTagFilter === tag.tag_id}
            onClick={() => handleTagChipClick(tag.tag_id)}
            className={`min-h-11 shrink-0 rounded-full border px-3 py-1 text-xs sm:min-h-8 sm:px-2.5 sm:py-0.5 ${
              TAG_BADGE_CLASSES[tag.color]
            } ${activeTagFilter === tag.tag_id ? "ring-1 ring-emerald-400" : ""}`}
          >
            {tag.name}
          </button>
        ))}
      </div>

      {/* Mobile-first stacked cards (< 768px) */}
      <div className="min-w-0 space-y-2.5 md:hidden">
        {activeTab === "active"
          ? groupBy === "none"
            ? pagedActive.map(renderMobileActiveCard)
            : groupedActive.map(([gid, group]) => {
                const collapsed = collapsedGroups.has(gid);
                return (
                  <div key={gid} className="space-y-2">
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() =>
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev);
                          if (next.has(gid)) next.delete(gid);
                          else next.add(gid);
                          return next;
                        })
                      }
                      className="flex w-full items-center justify-between rounded-lg bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-200"
                    >
                      <span>
                        {group.label} ({group.rows.length})
                      </span>
                      <span>{collapsed ? "+" : "−"}</span>
                    </button>
                    {!collapsed && group.rows.map(renderMobileActiveCard)}
                  </div>
                );
              })
          : filteredBought.map(renderMobileBoughtCard)}
      </div>

      {/* Desktop table (>= 768px) */}
      <div
        data-scroll-container="true"
        className="hidden overflow-x-auto md:block"
      >
        {activeTab === "active" ? (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-2">
                  <button type="button" onClick={() => toggleSort("name")}>
                    Product Name
                  </button>
                </th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2">
                  <button type="button" onClick={() => toggleSort("initial_price")}>
                    Baseline
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" onClick={() => toggleSort("current_price")}>
                    Current Price
                  </button>
                </th>
                <th className="px-3 py-2">
                  <button type="button" onClick={() => toggleSort("target_price")}>
                    Target Alert
                  </button>
                </th>
                <th className="px-3 py-2">Trend Dynamic</th>
                <th className="px-3 py-2">
                  <button type="button" onClick={() => toggleSort("drop_pct")}>
                    Drop %
                  </button>
                </th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groupBy === "none"
                ? pagedActive.map(renderActiveRow)
                : groupedActive.map(([gid, group]) => {
                    const collapsed = collapsedGroups.has(gid);
                    const avgDrop =
                      group.rows.reduce((sum, r) => sum + r.drop_pct, 0) /
                      Math.max(1, group.rows.length);
                    return (
                      <FragmentGroup
                        key={gid}
                        groupId={gid}
                        label={group.label}
                        count={group.rows.length}
                        avgDrop={avgDrop}
                        collapsed={collapsed}
                        onToggle={() =>
                          setCollapsedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(gid)) next.delete(gid);
                            else next.add(gid);
                            return next;
                          })
                        }
                      >
                        {!collapsed && group.rows.map(renderActiveRow)}
                      </FragmentGroup>
                    );
                  })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-3 py-2">Product Name</th>
                <th className="px-3 py-2">Tags</th>
                <th className="px-3 py-2">Baseline</th>
                <th className="px-3 py-2">Bought Price</th>
                <th className="px-3 py-2">Realized Savings</th>
                <th className="px-3 py-2">Date Bought</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBought.map((item) => (
                <tr key={item.item_id} className="border-t border-slate-800/80">
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpenItem(item.item_id)}
                      className="font-medium text-slate-100 hover:text-emerald-300"
                    >
                      {item.name}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">{renderTagChips(item.tag_ids)}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-400">
                    {formatMoney(item.currency, item.initial_price)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-slate-100">
                    {formatMoney(item.currency, item.purchased_price)}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-semibold text-emerald-400">
                    +{formatMoney(item.currency, item.saved_cost)} SAVED
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{item.purchased_date}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenItem(item.item_id)}
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      View Card
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {activeTab === "active" && groupBy === "none" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            Showing{" "}
            {filteredActive.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–
            {Math.min(safePage * PAGE_SIZE, filteredActive.length)} of{" "}
            {filteredActive.length} active positions
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-11 rounded border border-slate-700 px-3 py-1 disabled:opacity-40 sm:min-h-9 sm:px-2.5"
            >
              &larr; Prev
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-11 rounded border border-slate-700 px-3 py-1 disabled:opacity-40 sm:min-h-9 sm:px-2.5"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function FragmentGroup({
  groupId,
  label,
  count,
  avgDrop,
  collapsed,
  onToggle,
  children,
}: {
  groupId: string;
  label: string;
  count: number;
  avgDrop: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr key={`group-${groupId}`} className="bg-slate-800/50">
        <td colSpan={8} className="px-3 py-2">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={onToggle}
            className="flex w-full items-center justify-between text-left text-xs font-semibold text-slate-200"
          >
            <span>
              {label} ({count})
            </span>
            <span className="font-mono text-emerald-400">
              Avg Drop: -{avgDrop.toFixed(1)}%
            </span>
          </button>
        </td>
      </tr>
      {children}
    </>
  );
}
