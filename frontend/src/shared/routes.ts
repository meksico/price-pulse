import type { AppView } from "../ui/Header";

export type GridTab = "active" | "manual" | "bought";
export type AddModalMode = "single" | "bulk";

export interface AddModalPrefill {
  url?: string;
  title?: string;
  price?: string;
  currency?: string;
  image?: string;
  shortcutVersion?: string;
}

export interface AppRoute {
  view: AppView;
  gridTab: GridTab;
  tagFilter: string;
  itemId: string | null;
  addModalOpen: boolean;
  addModalMode: AddModalMode;
  addPrefill?: AddModalPrefill | null;
}

/**
 * Centralized Route Registry (RULE-ROUTING / RULE-DEEP-LINK).
 * Single source of truth for all page, modal, and filter URLs.
 */
export const ROUTES = {
  root: "/",
  dashboard: "/dashboard",
  tags: "/tags",
  health: "/health",
  addItem: "/items/new",
  itemDetailsPrefix: "/items/",
} as const;

export function getBasePath(): string {
  const raw = import.meta.env.BASE_URL || "/";
  if (raw === "/" || raw === "./") return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

export function parseRoute(pathname: string, search: string): AppRoute {
  const params = new URLSearchParams(search);
  const rawTab = params.get("tab");
  const gridTab: GridTab =
    rawTab === "bought" ? "bought" : rawTab === "manual" ? "manual" : "active";
  const tagParam = params.get("tag")?.trim() ?? "";
  const tagFilter = tagParam.length > 0 ? tagParam : "ALL";
  const modalParam = params.get("modal");
  const addModalMode: AddModalMode =
    params.get("mode") === "bulk" ? "bulk" : "single";
  const prefillUrl = params.get("url")?.trim() ?? "";
  const prefillTitle = params.get("title")?.trim() ?? "";
  const prefillPrice = params.get("price")?.trim() ?? "";
  const prefillCurrency = params.get("currency")?.trim() ?? "";
  const prefillImage = params.get("image")?.trim() ?? "";
  const prefillShortcutVersion = params.get("sv")?.trim() ?? "";
  const addPrefill: AddModalPrefill | null =
    prefillUrl ||
    prefillTitle ||
    prefillPrice ||
    prefillCurrency ||
    prefillImage ||
    prefillShortcutVersion
      ? {
          url: prefillUrl || undefined,
          title: prefillTitle || undefined,
          price: prefillPrice || undefined,
          currency: prefillCurrency || undefined,
          image: prefillImage || undefined,
          shortcutVersion: prefillShortcutVersion || undefined,
        }
      : null;

  const base = getBasePath();
  const withoutBase =
    base && pathname.startsWith(base) ? pathname.slice(base.length) || "/" : pathname;

  const cleanPath =
    withoutBase.length > 1 && withoutBase.endsWith("/")
      ? withoutBase.slice(0, -1)
      : withoutBase;

  if (cleanPath === ROUTES.tags) {
    const isAddOpen = modalParam === "add";
    return {
      view: "tags",
      gridTab: "active",
      tagFilter: "ALL",
      itemId: null,
      addModalOpen: isAddOpen,
      addModalMode: isAddOpen ? addModalMode : "single",
    };
  }
  if (cleanPath === ROUTES.health) {
    const isAddOpen = modalParam === "add";
    return {
      view: "health",
      gridTab: "active",
      tagFilter: "ALL",
      itemId: null,
      addModalOpen: isAddOpen,
      addModalMode: isAddOpen ? addModalMode : "single",
    };
  }
  if (cleanPath === ROUTES.addItem) {
    return {
      view: "dashboard",
      gridTab,
      tagFilter,
      itemId: null,
      addModalOpen: true,
      addModalMode,
      addPrefill,
    };
  }
  if (cleanPath.startsWith(ROUTES.itemDetailsPrefix)) {
    const rawId = cleanPath.slice(ROUTES.itemDetailsPrefix.length);
    const decoded = rawId ? decodeURIComponent(rawId) : "";
    if (decoded && decoded !== "new") {
      return {
        view: "dashboard",
        gridTab,
        tagFilter,
        itemId: decoded,
        addModalOpen: false,
        addModalMode: "single",
      };
    }
  }

  const isAddOpen = modalParam === "add";
  return {
    view: "dashboard",
    gridTab,
    tagFilter,
    itemId: null,
    addModalOpen: isAddOpen,
    addModalMode: isAddOpen ? addModalMode : "single",
  };
}

export function buildRouteUrl(route: AppRoute): string {
  let path: string = ROUTES.dashboard;
  if (route.itemId) {
    path = `${ROUTES.itemDetailsPrefix}${encodeURIComponent(route.itemId)}`;
  } else if (route.addModalOpen && route.view === "dashboard") {
    path = ROUTES.addItem;
  } else if (route.view === "tags") {
    path = ROUTES.tags;
  } else if (route.view === "health") {
    path = ROUTES.health;
  }

  const params = new URLSearchParams();
  if (route.view === "dashboard") {
    if (route.gridTab === "bought" || route.gridTab === "manual") {
      params.set("tab", route.gridTab);
    }
    if (route.tagFilter && route.tagFilter !== "ALL") {
      params.set("tag", route.tagFilter);
    }
  }
  if (route.addModalOpen && route.view !== "dashboard" && !route.itemId) {
    params.set("modal", "add");
  }
  if (route.addModalOpen && route.addModalMode === "bulk" && !route.itemId) {
    params.set("mode", "bulk");
  }

  const qs = params.toString();
  const base = getBasePath();
  const fullPath = `${base}${path}`;
  return qs ? `${fullPath}?${qs}` : fullPath;
}

