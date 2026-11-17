import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BoughtItem,
  BulkTagAction,
  PriceSnapshot,
  Tag,
  TrackedItem,
} from "../domain/models";
import {
  TAG_ACTIVE_BADGE_CLASSES,
  TAG_BADGE_CLASSES,
  TAG_DOT_CLASSES,
  formatMoney,
} from "../domain/models";
import { ANCHORS } from "../shared/anchors";
import type { GridTab } from "../shared/routes";
import { TagAdderControl } from "./TagAdderControl";

type GroupMode = "none" | "tag";
type SortField =
  | "added"
  | "name"
  | "initial_price"
  | "current_price"
  | "target_price"
  | "drop_pct";

const PAGE_SIZE = 15;
const MANUAL_CHECK_TAG = "manual check";

function getLastCheckDateStr(lastCheckedIso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(lastCheckedIso.trim());
  if (match) return match[1];
  const ms = Date.parse(lastCheckedIso);
  if (Number.isNaN(ms)) return lastCheckedIso;
  return new Date(ms).toISOString().slice(0, 10);
}

function getDaysSinceLastCheck(lastCheckedIso: string, now = new Date()): number {
  const dateStr = getLastCheckDateStr(lastCheckedIso);
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return 0;
  const checkedUtcMs = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const todayUtcMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.max(0, Math.floor((todayUtcMs - checkedUtcMs) / 86_400_000));
}

function getManualCheckRowClass(days: number): string {
  if (days >= 6) return "bg-red-50 hover:bg-red-100/70";
  if (days >= 1) return "bg-amber-50 hover:bg-amber-100/70";
  return "hover:bg-gray-50/70";
}

function getManualCheckCardClass(days: number): string {
  if (days >= 6) return "border-red-200 bg-red-50";
  if (days >= 1) return "border-amber-200 bg-amber-50";
  return "border-gray-200 bg-white";
}

function WarningTriangleIcon({ days }: { days: number }) {
  const colorClass = days >= 6 ? "text-red-500" : "text-amber-500";
  const label = `Last checked ${days} day${days === 1 ? "" : "s"} ago`;
  return (
    <span
      title={label}
      data-manual-warning={days >= 6 ? "red" : "amber"}
      className={`inline-flex shrink-0 items-center ${colorClass}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </span>
  );
}

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
  onBulkUpdateTags: (
    itemIds: string[],
    action: BulkTagAction,
    tagNames: string[],
  ) => Promise<void>;
  onBulkRecheck: (itemIds: string[]) => Promise<void>;
  onBulkDelete: (itemIds: string[]) => Promise<void>;
}

function Sparkline({ snapshots }: { snapshots: PriceSnapshot[] }) {
  if (snapshots.length < 2) {
    return <span className="text-xs text-zinc-400">&mdash;</span>;
  }
  const prices = snapshots.map((s) => s.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(0.01, max - min);
  const pts = prices
    .map((p, idx) => {
      const x = 2 + (idx / (prices.length - 1)) * 60;
      const y = 18 - ((p - min) / span) * 14;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width="64" height="22" aria-hidden="true" className="inline-block">
      <polyline
        fill="none"
        stroke="#2563EB"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
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
  onBulkUpdateTags,
  onBulkRecheck,
  onBulkDelete,
}: PositionsGridProps) {
  const [groupBy, setGroupBy] = useState<GroupMode>("none");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [isMobileScrolledPast, setIsMobileScrolledPast] = useState(false);
  const [isStickyExpanded, setIsStickyExpanded] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusyAction, setBulkBusyAction] = useState<
    "tags" | "recheck" | "delete" | null
  >(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [isBulkTagOpen, setIsBulkTagOpen] = useState(false);
  const [bulkTagMode, setBulkTagMode] = useState<BulkTagAction>("add");
  const [bulkTagNames, setBulkTagNames] = useState<string[]>([]);

  const filtrationHeaderRef = useRef<HTMLDivElement>(null);
  const stickyPanelRef = useRef<HTMLDivElement>(null);
  const bulkTagContainerRef = useRef<HTMLDivElement>(null);
  const selectAllDesktopRef = useRef<HTMLInputElement>(null);
  const selectAllMobileRef = useRef<HTMLInputElement>(null);
  const expandedScrollYRef = useRef<number>(0);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");

    const evaluateScroll = () => {
      if (!mediaQuery.matches) {
        setIsMobileScrolledPast(false);
        setIsStickyExpanded(false);
        return;
      }
      const headerEl = filtrationHeaderRef.current;
      if (!headerEl) {
        setIsMobileScrolledPast(false);
        return;
      }
      const passed = headerEl.getBoundingClientRect().bottom <= 0;
      setIsMobileScrolledPast(passed);
      if (!passed) {
        setIsStickyExpanded(false);
      }
    };

    evaluateScroll();
    window.addEventListener("scroll", evaluateScroll, { passive: true });
    window.addEventListener("resize", evaluateScroll);
    mediaQuery.addEventListener("change", evaluateScroll);
    return () => {
      window.removeEventListener("scroll", evaluateScroll);
      window.removeEventListener("resize", evaluateScroll);
      mediaQuery.removeEventListener("change", evaluateScroll);
    };
  }, []);

  useEffect(() => {
    if (!isStickyExpanded) return;
    expandedScrollYRef.current = window.scrollY;

    const handleScrollCollapse = () => {
      if (Math.abs(window.scrollY - expandedScrollYRef.current) >= 24) {
        setIsStickyExpanded(false);
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (stickyPanelRef.current && !stickyPanelRef.current.contains(target)) {
        setIsStickyExpanded(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsStickyExpanded(false);
      }
    };

    window.addEventListener("scroll", handleScrollCollapse, { passive: true });
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", handleScrollCollapse);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isStickyExpanded]);

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

  const manualCheckItemsAll = useMemo(
    () =>
      items.filter((item) =>
        item.tag_ids.some(
          (id) =>
            tagById.get(id)?.name.trim().toLowerCase() === MANUAL_CHECK_TAG,
        ),
      ),
    [items, tagById],
  );

  const maxManualAgeDays = useMemo(
    () =>
      manualCheckItemsAll.reduce(
        (max, item) => Math.max(max, getDaysSinceLastCheck(item.last_checked)),
        0,
      ),
    [manualCheckItemsAll],
  );

  const filteredActive = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sourceItems =
      activeTab === "manual" ? manualCheckItemsAll : items;
    const list = sourceItems.filter((item) => {
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
    if (sortField === "added") {
      return [...list].reverse();
    }
    return [...list].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sortAsc ? cmp : -cmp;
    });
  }, [
    activeTab,
    items,
    manualCheckItemsAll,
    activeTagFilter,
    searchQuery,
    sortField,
    sortAsc,
    tagById,
  ]);

  const filteredBought = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...boughtItems].reverse().filter((item) => {
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

  const validTabItemIds = useMemo(() => {
    if (activeTab === "bought") {
      return new Set(boughtItems.map((i) => i.item_id));
    }
    if (activeTab === "manual") {
      return new Set(manualCheckItemsAll.map((i) => i.item_id));
    }
    return new Set(items.map((i) => i.item_id));
  }, [activeTab, items, manualCheckItemsAll, boughtItems]);

  const visibleItemIds = useMemo(() => {
    const raw =
      activeTab === "bought"
        ? filteredBought.map((i) => i.item_id)
        : pagedActive.map((i) => i.item_id);
    return Array.from(new Set(raw));
  }, [activeTab, filteredBought, pagedActive]);

  useEffect(() => {
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    setIsBulkTagOpen(false);
    setBulkTagNames([]);
  }, [activeTab]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validTabItemIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [validTabItemIds]);

  const allVisibleSelected =
    visibleItemIds.length > 0 &&
    visibleItemIds.every((id) => selectedIds.has(id));
  const someVisibleSelected =
    visibleItemIds.some((id) => selectedIds.has(id)) && !allVisibleSelected;

  useEffect(() => {
    if (selectAllDesktopRef.current) {
      selectAllDesktopRef.current.indeterminate = someVisibleSelected;
    }
    if (selectAllMobileRef.current) {
      selectAllMobileRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  useEffect(() => {
    if (!isBulkTagOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        bulkTagContainerRef.current &&
        !bulkTagContainerRef.current.contains(target)
      ) {
        setIsBulkTagOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsBulkTagOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBulkTagOpen]);

  const tagsOnSelectedItems = useMemo(() => {
    if (activeTab === "bought" || selectedIds.size === 0) return [];
    const presentIds = new Set<string>();
    for (const item of items) {
      if (selectedIds.has(item.item_id)) {
        for (const tid of item.tag_ids) {
          presentIds.add(tid);
        }
      }
    }
    return tags.filter((t) => presentIds.has(t.tag_id));
  }, [activeTab, items, selectedIds, tags]);

  const toggleSelectItem = (itemId: string) => {
    setConfirmBulkDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setConfirmBulkDelete(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleItemIds) next.delete(id);
      } else {
        for (const id of visibleItemIds) next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
    setIsBulkTagOpen(false);
    setBulkTagNames([]);
  };

  const handleApplyBulkTags = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (bulkTagMode !== "replace" && bulkTagNames.length === 0) return;
    setBulkBusyAction("tags");
    try {
      await onBulkUpdateTags(ids, bulkTagMode, bulkTagNames);
      setIsBulkTagOpen(false);
      setBulkTagNames([]);
    } finally {
      setBulkBusyAction(null);
    }
  };

  const handleRunBulkRecheck = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusyAction("recheck");
    setIsBulkTagOpen(false);
    setConfirmBulkDelete(false);
    try {
      await onBulkRecheck(ids);
    } finally {
      setBulkBusyAction(null);
    }
  };

  const handleConfirmBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusyAction("delete");
    setIsBulkTagOpen(false);
    try {
      await onBulkDelete(ids);
      clearSelection();
    } finally {
      setBulkBusyAction(null);
    }
  };

  const bulkBusy = bulkBusyAction !== null;

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
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
              active
                ? TAG_ACTIVE_BADGE_CLASSES[tag.color]
                : TAG_BADGE_CLASSES[tag.color]
            }`}
          >
            {tag.name}
          </button>
        );
      })}
    </div>
  );

  const renderCompactTagBadges = (tagIds: string[]) => (
    <>
      {tagIds.map((tid) => {
        const tag = tagById.get(tid);
        if (!tag) return null;
        const active = activeTagFilter === tid;
        return (
          <span
            key={tid}
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-tight ${
              active
                ? TAG_ACTIVE_BADGE_CLASSES[tag.color]
                : TAG_BADGE_CLASSES[tag.color]
            }`}
          >
            {tag.name}
          </span>
        );
      })}
    </>
  );

  const renderMobileActiveCard = (item: TrackedItem) => {
    const isManualTab = activeTab === "manual";
    const daysSince = isManualTab ? getDaysSinceLastCheck(item.last_checked) : 0;
    const cardTone = isManualTab
      ? getManualCheckCardClass(daysSince)
      : "border-gray-200 bg-white";
    const checked = selectedIds.has(item.item_id);
    return (
      <article
        key={item.item_id}
        data-manual-age-days={isManualTab ? daysSince : undefined}
        className="flex min-w-0 items-start gap-2"
      >
        <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg pt-1">
          <input
            type="checkbox"
            checked={checked}
            disabled={bulkBusy}
            onChange={() => toggleSelectItem(item.item_id)}
            aria-label={`Select ${item.name}`}
            className="h-5 w-5 cursor-pointer rounded border-gray-300 accent-zinc-950"
          />
        </label>
        <button
          type="button"
          onClick={() => onOpenItem(item.item_id)}
          className={`flex min-w-0 flex-1 items-stretch gap-3 rounded-xl border p-2.5 text-left transition-colors hover:border-zinc-300 ${
            checked ? "ring-2 ring-zinc-950/20 " : ""
          }${cardTone}`}
        >
          <div className="min-h-[140px] max-h-[160px] w-24 shrink-0 self-stretch overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
            {item.image_url ? (
              <img
                src={item.image_url}
                alt=""
                className="h-full w-full object-cover object-center"
              />
            ) : (
              <div className="h-full w-full bg-gray-100" aria-hidden="true" />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1">
              {isManualTab && daysSince >= 1 && (
                <WarningTriangleIcon days={daysSince} />
              )}
              {item.status === "DISCOUNT" ? (
                <span className="tabular-nums shrink-0 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                  -{item.drop_pct}%
                </span>
              ) : (
                <span className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                  NORMAL
                </span>
              )}
              {renderCompactTagBadges(item.tag_ids)}
            </div>

            <div
              title={item.name}
              className="line-clamp-2 text-[13px] font-semibold leading-snug text-zinc-950"
            >
              {item.name}
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs">
              <div className="min-w-0">
                <div className="text-[10px] font-medium leading-tight text-zinc-500">
                  Baseline
                </div>
                <div className="tabular-nums truncate text-xs text-zinc-600">
                  {formatMoney(item.currency, item.initial_price)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-medium leading-tight text-zinc-500">
                  Current
                </div>
                <div className="tabular-nums truncate text-xs font-semibold text-zinc-950">
                  {formatMoney(item.currency, item.current_price)}
                </div>
              </div>
            </div>

            {isManualTab && (
              <div className="tabular-nums text-[10px] text-zinc-600">
                Last check: {getLastCheckDateStr(item.last_checked)}
              </div>
            )}
          </div>
        </button>
      </article>
    );
  };

  const renderMobileBoughtCard = (item: BoughtItem) => {
    const checked = selectedIds.has(item.item_id);
    return (
      <article key={item.item_id} className="flex min-w-0 items-start gap-2">
        <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg pt-1">
          <input
            type="checkbox"
            checked={checked}
            disabled={bulkBusy}
            onChange={() => toggleSelectItem(item.item_id)}
            aria-label={`Select ${item.name}`}
            className="h-5 w-5 cursor-pointer rounded border-gray-300 accent-zinc-950"
          />
        </label>
        <button
          type="button"
          onClick={() => onOpenItem(item.item_id)}
          className={`flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-gray-200 bg-white p-2.5 text-left transition-colors hover:border-zinc-300 ${
            checked ? "ring-2 ring-zinc-950/20" : ""
          }`}
        >
        <div className="flex flex-wrap items-center gap-1">
          <span className="tabular-nums shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-950">
            +{formatMoney(item.currency, item.saved_cost)}
          </span>
          {renderCompactTagBadges(item.tag_ids)}
        </div>
        <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-zinc-950">
          {item.name}
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs">
          <div className="min-w-0">
            <div className="text-[10px] font-medium leading-tight text-zinc-500">
              Baseline
            </div>
            <div className="tabular-nums truncate text-xs text-zinc-600">
              {formatMoney(item.currency, item.initial_price)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium leading-tight text-zinc-500">
              Bought
            </div>
            <div className="tabular-nums truncate text-xs font-semibold text-zinc-950">
              {formatMoney(item.currency, item.purchased_price)}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-medium leading-tight text-zinc-500">
              Date
            </div>
            <div className="tabular-nums truncate text-xs text-zinc-600">
              {item.purchased_date}
            </div>
          </div>
        </div>
      </button>
    </article>
    );
  };

  const renderActiveRow = (item: TrackedItem) => {
    const snaps = priceHistory.filter((s) => s.item_id === item.item_id);
    const isManualTab = activeTab === "manual";
    const daysSince = isManualTab ? getDaysSinceLastCheck(item.last_checked) : 0;
    const rowTone = isManualTab
      ? getManualCheckRowClass(daysSince)
      : "hover:bg-gray-50/70";
    const checked = selectedIds.has(item.item_id);
    return (
      <tr
        key={item.item_id}
        data-manual-age-days={isManualTab ? daysSince : undefined}
        className={`border-b border-gray-100 transition-colors last:border-b-0 ${
          checked ? "bg-zinc-50/90" : rowTone
        }`}
      >
        <td className="w-10 py-3 pl-2 pr-1">
          <input
            type="checkbox"
            checked={checked}
            disabled={bulkBusy}
            onChange={() => toggleSelectItem(item.item_id)}
            aria-label={`Select ${item.name}`}
            className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-zinc-950"
          />
        </td>
        <td className={`py-3 pr-3 ${isManualTab ? "pl-2.5" : ""}`}>
          <div className="flex items-center gap-3">
            {isManualTab && daysSince >= 1 && (
              <WarningTriangleIcon days={daysSince} />
            )}
            {item.image_url ? (
              <img
                src={item.image_url}
                alt=""
                className="h-11 w-11 shrink-0 rounded-lg border border-gray-200/70 bg-gray-100 object-cover"
              />
            ) : (
              <div className="h-11 w-11 shrink-0 rounded-lg border border-gray-200/70 bg-gray-100" />
            )}
            <button
              type="button"
              onClick={() => onOpenItem(item.item_id)}
              title={item.name}
              className="max-w-xs truncate text-left text-[13px] font-medium text-zinc-950 hover:text-blue-600"
            >
              {item.name}
            </button>
          </div>
        </td>
        <td className="px-2 py-3">{renderTagChips(item.tag_ids)}</td>
        <td className="tabular-nums px-2 py-3 text-right text-xs text-zinc-500">
          {formatMoney(item.currency, item.initial_price)}
        </td>
        <td className="tabular-nums px-2 py-3 text-right text-[13px] font-semibold text-zinc-950">
          {formatMoney(item.currency, item.current_price)}
        </td>
        <td className="tabular-nums px-2 py-3 text-right text-xs text-zinc-500">
          {formatMoney(item.currency, item.target_price)}
        </td>
        <td className="px-3 py-3 text-right">
          <Sparkline snapshots={snaps} />
        </td>
        <td className="px-2 py-3 text-right">
          {item.status === "DISCOUNT" ? (
            <span className="tabular-nums rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              -{item.drop_pct}%
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
              NORMAL
            </span>
          )}
        </td>
        {isManualTab && (
          <td className="tabular-nums whitespace-nowrap px-2 py-3 text-right text-xs text-zinc-700">
            {getLastCheckDateStr(item.last_checked)}
          </td>
        )}
        <td className="py-3 pl-3 text-right">
          <button
            type="button"
            onClick={() => onOpenItem(item.item_id)}
            className="h-8 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-gray-100"
          >
            Item Card &rarr;
          </button>
        </td>
      </tr>
    );
  };

  const activeSectionLabel =
    activeTab === "active"
      ? "Active Positions"
      : activeTab === "manual"
        ? "Manual check"
        : "Bought Items Sheet";
  const activeTagObj =
    activeTagFilter !== "ALL" ? tagById.get(activeTagFilter) : undefined;
  const activeTagLabel = activeTagObj ? activeTagObj.name : "Show All";

  const renderFiltrationControls = (idPrefix: string, withAnchors: boolean) => (
    <>
      <div
        id={withAnchors ? ANCHORS.gridPanelToolbar : undefined}
        className="mb-3 flex min-w-0 flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between"
      >
        <div
          role="tablist"
          aria-label="Grid dataset view"
          className="grid min-w-0 grid-cols-1 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "active"}
            onClick={() => {
              setPage(1);
              onTabChange("active");
            }}
            className={`tabular-nums min-h-11 min-w-0 truncate rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors sm:min-h-8 ${
              activeTab === "active"
                ? "bg-zinc-950 text-white"
                : "bg-gray-100 text-zinc-900 hover:bg-gray-200"
            }`}
          >
            Active Positions ({items.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "manual"}
            onClick={() => {
              setPage(1);
              onTabChange("manual");
            }}
            className={`tabular-nums relative min-h-11 min-w-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors sm:min-h-8 ${
              activeTab === "manual"
                ? "bg-zinc-950 text-white"
                : "bg-gray-100 text-zinc-900 hover:bg-gray-200"
            }`}
          >
            <span className="block truncate">
              Manual check ({manualCheckItemsAll.length})
            </span>
            {manualCheckItemsAll.length > 0 && maxManualAgeDays >= 1 && (
              <span
                aria-hidden="true"
                data-manual-indicator={maxManualAgeDays >= 6 ? "red" : "amber"}
                className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
                  maxManualAgeDays >= 6 ? "bg-red-500" : "bg-amber-400"
                }`}
              />
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "bought"}
            onClick={() => onTabChange("bought")}
            className={`tabular-nums min-h-11 min-w-0 truncate rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors sm:min-h-8 ${
              activeTab === "bought"
                ? "bg-zinc-950 text-white"
                : "bg-gray-100 text-zinc-900 hover:bg-gray-200"
            }`}
          >
            Bought Items Sheet ({boughtItems.length})
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 items-center gap-2">
            {activeTab === "active" && (
              <>
                <label
                  htmlFor={`${idPrefix}-group-by`}
                  className="shrink-0 text-xs text-zinc-500"
                >
                  Group By
                </label>
                <select
                  id={`${idPrefix}-group-by`}
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupMode)}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-950 sm:min-h-9 sm:flex-none"
                >
                  <option value="none">Flat List (None)</option>
                  <option value="tag">Tag</option>
                </select>
              </>
            )}
          </div>
          <label htmlFor={`${idPrefix}-search`} className="sr-only">
            Search items or tags
          </label>
          <input
            id={`${idPrefix}-search`}
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Search products or tags..."
            className="min-h-11 w-full rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-950 sm:min-h-9 sm:w-56"
          />
        </div>
      </div>

      <div
        id={withAnchors ? ANCHORS.gridPanelTagBar : undefined}
        data-scroll-container="true"
        className="no-scrollbar mb-3 flex items-center gap-2 overflow-x-auto border-b border-gray-100 pb-2.5"
      >
        <span className="shrink-0 text-xs text-zinc-500">Filter by Tag:</span>
        <button
          type="button"
          aria-pressed={activeTagFilter === "ALL"}
          onClick={() => {
            setPage(1);
            onTagFilterChange("ALL");
          }}
          className={`min-h-11 shrink-0 rounded-lg border px-3 py-1 text-xs font-medium transition-colors sm:min-h-8 ${
            activeTagFilter === "ALL"
              ? "border-zinc-950 bg-zinc-950 text-white"
              : "border-gray-200 bg-white text-zinc-950 hover:bg-gray-50"
          }`}
        >
          Show All
        </button>
        {distinctActiveTags.map((tag) => {
          const isActive = activeTagFilter === tag.tag_id;
          return (
            <button
              key={tag.tag_id}
              type="button"
              aria-pressed={isActive}
              onClick={() => handleTagChipClick(tag.tag_id)}
              className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition-colors sm:min-h-8 ${
                isActive
                  ? TAG_ACTIVE_BADGE_CLASSES[tag.color]
                  : `${TAG_BADGE_CLASSES[tag.color]} hover:opacity-85`
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  isActive ? "bg-white" : TAG_DOT_CLASSES[tag.color]
                }`}
              />
              {tag.name}
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <section
      id={ANCHORS.gridPanel}
      aria-label="Tracked positions and bought items"
      className="@container min-w-0 rounded-xl border border-gray-200 bg-white p-3.5 sm:p-4"
    >
      {isMobileScrolledPast && !isStickyExpanded && (
        <div
          id={ANCHORS.gridPanelStickyRibbon}
          className="fixed inset-x-0 top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur md:hidden"
        >
          <button
            type="button"
            aria-expanded={false}
            aria-controls={ANCHORS.gridPanelStickyPanel}
            onClick={() => setIsStickyExpanded(true)}
            className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left text-xs"
          >
            <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <span className="truncate font-semibold text-zinc-950 underline decoration-zinc-300 underline-offset-2">
                {activeSectionLabel}
              </span>
              <span aria-hidden="true" className="shrink-0 text-zinc-400">
                /
              </span>
              <span className="inline-flex min-w-0 items-center gap-1 truncate font-medium text-blue-600 underline decoration-blue-200 underline-offset-2">
                {activeTagObj && (
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${TAG_DOT_CLASSES[activeTagObj.color]}`}
                  />
                )}
                <span className="truncate">{activeTagLabel}</span>
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-zinc-500">
              <span>Filters</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
        </div>
      )}

      {isMobileScrolledPast && isStickyExpanded && (
        <div
          ref={stickyPanelRef}
          id={ANCHORS.gridPanelStickyPanel}
          className="fixed inset-x-0 top-0 z-40 max-h-[85dvh] overflow-y-auto border-b border-gray-200 bg-white p-3.5 shadow-lg md:hidden"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-950">
              View &amp; Tag Filters
            </span>
            <button
              type="button"
              aria-label="Collapse filters"
              onClick={() => setIsStickyExpanded(false)}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-zinc-600 hover:bg-gray-100 hover:text-zinc-950"
            >
              <span>Done</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          </div>
          {renderFiltrationControls("grid-sticky", false)}
        </div>
      )}

      <div ref={filtrationHeaderRef}>
        {renderFiltrationControls("grid", true)}
      </div>

      {selectedIds.size > 0 && (
        <div
          id={ANCHORS.gridPanelBulkBar}
          role="region"
          aria-label="Bulk actions"
          aria-busy={bulkBusy}
          className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-gray-50 px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <span className="tabular-nums text-xs font-semibold text-zinc-950">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={clearSelection}
              className="min-h-11 rounded-lg px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-gray-200/70 hover:text-zinc-950 disabled:opacity-50 sm:min-h-8"
            >
              Clear
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeTab !== "bought" && (
              <>
                <div ref={bulkTagContainerRef} className="relative">
                  <button
                    type="button"
                    disabled={bulkBusy}
                    aria-expanded={isBulkTagOpen}
                    aria-controls={ANCHORS.gridPanelBulkTagPopover}
                    onClick={() => {
                      setConfirmBulkDelete(false);
                      setIsBulkTagOpen((prev) => !prev);
                    }}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-gray-100 disabled:opacity-50 sm:min-h-8"
                  >
                    <span>
                      {bulkBusyAction === "tags"
                        ? "Updating tags..."
                        : "Manage Tags"}
                    </span>
                    <span aria-hidden="true" className="text-[10px]">
                      {isBulkTagOpen ? "\u25b4" : "\u25be"}
                    </span>
                  </button>

                  {isBulkTagOpen && (
                    <div
                      id={ANCHORS.gridPanelBulkTagPopover}
                      role="dialog"
                      aria-label="Bulk manage tags"
                      className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-3 shadow-lg sm:left-auto sm:right-0 sm:w-80"
                    >
                      <div
                        role="tablist"
                        aria-label="Bulk tag action mode"
                        className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1"
                      >
                        {(["add", "replace", "remove"] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            role="tab"
                            aria-selected={bulkTagMode === mode}
                            onClick={() => {
                              setBulkTagMode(mode);
                              setBulkTagNames([]);
                            }}
                            className={`min-h-9 rounded-md px-2 text-xs font-medium capitalize transition-colors ${
                              bulkTagMode === mode
                                ? "bg-zinc-950 text-white"
                                : "text-zinc-700 hover:text-zinc-950"
                            }`}
                          >
                            {mode === "replace" ? "Replace" : mode}
                          </button>
                        ))}
                      </div>

                      {bulkTagMode === "remove" ? (
                        <div className="space-y-2">
                          <p className="text-[11px] text-zinc-500">
                            Select tags to remove from the {selectedIds.size}{" "}
                            selected item{selectedIds.size === 1 ? "" : "s"}:
                          </p>
                          {tagsOnSelectedItems.length === 0 ? (
                            <p className="text-xs text-zinc-400">
                              Selected items have no tags.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {tagsOnSelectedItems.map((tag) => {
                                const picked = bulkTagNames.includes(tag.name);
                                return (
                                  <button
                                    key={tag.tag_id}
                                    type="button"
                                    aria-pressed={picked}
                                    onClick={() =>
                                      setBulkTagNames((prev) =>
                                        picked
                                          ? prev.filter((n) => n !== tag.name)
                                          : [...prev, tag.name],
                                      )
                                    }
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                      picked
                                        ? TAG_ACTIVE_BADGE_CLASSES[tag.color]
                                        : TAG_BADGE_CLASSES[tag.color]
                                    }`}
                                  >
                                    <span
                                      aria-hidden="true"
                                      className={`h-1.5 w-1.5 rounded-full ${
                                        picked
                                          ? "bg-white"
                                          : TAG_DOT_CLASSES[tag.color]
                                      }`}
                                    />
                                    {tag.name}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[11px] text-zinc-500">
                            {bulkTagMode === "add"
                              ? "Append tags while keeping existing tags:"
                              : "Replace all existing tags on selected items (leave empty to clear):"}
                          </p>
                          <TagAdderControl
                            idPrefix="bulk-tag"
                            availableTags={tags}
                            selectedTagNames={bulkTagNames}
                            onAddTag={(name) =>
                              setBulkTagNames((prev) =>
                                prev.some(
                                  (n) =>
                                    n.trim().toLowerCase() ===
                                    name.trim().toLowerCase(),
                                )
                                  ? prev
                                  : [...prev, name],
                              )
                            }
                            onRemoveTag={(name) =>
                              setBulkTagNames((prev) =>
                                prev.filter((n) => n !== name),
                              )
                            }
                          />
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-end gap-2 border-t border-gray-100 pt-2.5">
                        <button
                          type="button"
                          onClick={() => setIsBulkTagOpen(false)}
                          className="min-h-9 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={
                            bulkBusy ||
                            (bulkTagMode !== "replace" &&
                              bulkTagNames.length === 0)
                          }
                          onClick={() => void handleApplyBulkTags()}
                          className="min-h-9 rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-40"
                        >
                          {bulkTagMode === "add"
                            ? "Add Tags"
                            : bulkTagMode === "replace"
                              ? "Replace Tags"
                              : "Remove Tags"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void handleRunBulkRecheck()}
                  className="tabular-nums min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-zinc-950 transition-colors hover:bg-gray-100 disabled:opacity-50 sm:min-h-8"
                >
                  {bulkBusyAction === "recheck"
                    ? `Re-checking (${selectedIds.size})...`
                    : `Re-check (${selectedIds.size})`}
                </button>
              </>
            )}

            {!confirmBulkDelete ? (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => {
                  setIsBulkTagOpen(false);
                  setConfirmBulkDelete(true);
                }}
                className="tabular-nums min-h-11 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 sm:min-h-8"
              >
                Delete ({selectedIds.size})
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void handleConfirmBulkDelete()}
                  className="tabular-nums min-h-11 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50 sm:min-h-8"
                >
                  {bulkBusyAction === "delete"
                    ? "Deleting..."
                    : `Confirm Delete (${selectedIds.size})`}
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => setConfirmBulkDelete(false)}
                  className="min-h-11 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-gray-50 disabled:opacity-50 sm:min-h-8"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile-first stacked cards (< 768px) */}
      <div className="min-w-0 space-y-2.5 md:hidden">
        {visibleItemIds.length > 0 && (
          <div className="flex items-center justify-between border-b border-gray-100 pb-1.5">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-xs font-medium text-zinc-700">
              <input
                ref={selectAllMobileRef}
                type="checkbox"
                checked={allVisibleSelected}
                disabled={bulkBusy}
                onChange={toggleSelectAllVisible}
                aria-label="Select all visible items"
                className="h-5 w-5 cursor-pointer rounded border-gray-300 accent-zinc-950"
              />
              <span className="tabular-nums">
                Select all ({visibleItemIds.length})
              </span>
            </label>
          </div>
        )}
        {activeTab === "active" || activeTab === "manual"
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
                      className="flex min-h-11 w-full items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-zinc-950"
                    >
                      <span className="tabular-nums">
                        {group.label} ({group.rows.length})
                      </span>
                      <span>{collapsed ? "+" : "\u2212"}</span>
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
        {activeTab === "active" || activeTab === "manual" ? (
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="w-10 py-2 pl-2 pr-1">
                  <input
                    ref={selectAllDesktopRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={bulkBusy || visibleItemIds.length === 0}
                    onChange={toggleSelectAllVisible}
                    aria-label="Select all visible items"
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-zinc-950"
                  />
                </th>
                <th className="py-2 pr-3">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className="hover:text-zinc-950"
                  >
                    Product Name
                  </button>
                </th>
                <th className="px-2 py-2">Tags</th>
                <th className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("initial_price")}
                    className="hover:text-zinc-950"
                  >
                    Baseline
                  </button>
                </th>
                <th className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("current_price")}
                    className="hover:text-zinc-950"
                  >
                    Current Price
                  </button>
                </th>
                <th className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("target_price")}
                    className="hover:text-zinc-950"
                  >
                    Target Alert
                  </button>
                </th>
                <th className="px-3 py-2 text-right">Trend Dynamic</th>
                <th className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort("drop_pct")}
                    className="hover:text-zinc-950"
                  >
                    Drop %
                  </button>
                </th>
                {activeTab === "manual" && (
                  <th className="px-2 py-2 text-right">Last check</th>
                )}
                <th className="py-2 pl-3 text-right">Actions</th>
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
                        colSpan={activeTab === "manual" ? 10 : 9}
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
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <th className="w-10 py-2 pl-2 pr-1">
                  <input
                    ref={selectAllDesktopRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    disabled={bulkBusy || visibleItemIds.length === 0}
                    onChange={toggleSelectAllVisible}
                    aria-label="Select all visible items"
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-zinc-950"
                  />
                </th>
                <th className="py-2 pr-3">Product Name</th>
                <th className="px-2 py-2">Tags</th>
                <th className="px-2 py-2 text-right">Baseline</th>
                <th className="px-2 py-2 text-right">Bought Price</th>
                <th className="px-2 py-2 text-right">Realized Savings</th>
                <th className="px-2 py-2 text-right">Date Bought</th>
                <th className="py-2 pl-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBought.map((item) => {
                const checked = selectedIds.has(item.item_id);
                return (
                <tr
                  key={item.item_id}
                  className={`border-b border-gray-100 last:border-b-0 ${
                    checked ? "bg-zinc-50/90" : "hover:bg-gray-50/70"
                  }`}
                >
                  <td className="w-10 py-3 pl-2 pr-1">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={bulkBusy}
                      onChange={() => toggleSelectItem(item.item_id)}
                      aria-label={`Select ${item.name}`}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-zinc-950"
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <button
                      type="button"
                      onClick={() => onOpenItem(item.item_id)}
                      className="text-left text-[13px] font-medium text-zinc-950 hover:text-blue-600"
                    >
                      {item.name}
                    </button>
                  </td>
                  <td className="px-2 py-3">{renderTagChips(item.tag_ids)}</td>
                  <td className="tabular-nums px-2 py-3 text-right text-zinc-500">
                    {formatMoney(item.currency, item.initial_price)}
                  </td>
                  <td className="tabular-nums px-2 py-3 text-right font-semibold text-zinc-950">
                    {formatMoney(item.currency, item.purchased_price)}
                  </td>
                  <td className="tabular-nums px-2 py-3 text-right font-semibold text-zinc-950">
                    +{formatMoney(item.currency, item.saved_cost)} SAVED
                  </td>
                  <td className="tabular-nums px-2 py-3 text-right text-zinc-500">
                    {item.purchased_date}
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenItem(item.item_id)}
                      className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-zinc-950 hover:bg-gray-100"
                    >
                      View Card
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(activeTab === "active" || activeTab === "manual") &&
        groupBy === "none" && (
          <div className="tabular-nums mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
            <span>
              Showing{" "}
              {filteredActive.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
              &ndash;
              {Math.min(safePage * PAGE_SIZE, filteredActive.length)} of{" "}
              {filteredActive.length}{" "}
              {activeTab === "manual"
                ? "manual check positions"
                : "active positions"}
            </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-1 font-medium text-zinc-950 hover:bg-gray-50 disabled:opacity-40 sm:min-h-8 sm:px-2.5"
            >
              &larr; Prev
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-1 font-medium text-zinc-950 hover:bg-gray-50 disabled:opacity-40 sm:min-h-8 sm:px-2.5"
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
  colSpan,
  collapsed,
  onToggle,
  children,
}: {
  groupId: string;
  label: string;
  count: number;
  avgDrop: number;
  colSpan: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr key={`group-${groupId}`} className="bg-gray-100/80">
        <td colSpan={colSpan} className="px-3 py-2">
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={onToggle}
            className="flex w-full items-center justify-between text-left text-xs font-semibold text-zinc-950"
          >
            <span className="tabular-nums">
              {label} ({count})
            </span>
            <span className="tabular-nums text-zinc-600">
              Avg Drop: -{avgDrop.toFixed(1)}%
            </span>
          </button>
        </td>
      </tr>
      {children}
    </>
  );
}
