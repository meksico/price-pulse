import type { AppView } from "../ui/Header";

export type GridTab = "active" | "bought";

export interface AppRoute {
  view: AppView;
  gridTab: GridTab;
  tagFilter: string;
  itemId: string | null;
  addModalOpen: boolean;
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
  settings: "/settings",
  addItem: "/items/new",
  itemDetailsPrefix: "/items/",
} as const;

export function parseRoute(pathname: string, search: string): AppRoute {
  const params = new URLSearchParams(search);
  const gridTab: GridTab = params.get("tab") === "bought" ? "bought" : "active";
  const tagParam = params.get("tag")?.trim() ?? "";
  const tagFilter = tagParam.length > 0 ? tagParam : "ALL";
  const modalParam = params.get("modal");

  const cleanPath =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (cleanPath === ROUTES.tags) {
    return {
      view: "tags",
      gridTab: "active",
      tagFilter: "ALL",
      itemId: null,
      addModalOpen: modalParam === "add",
    };
  }
  if (cleanPath === ROUTES.health) {
    return {
      view: "health",
      gridTab: "active",
      tagFilter: "ALL",
      itemId: null,
      addModalOpen: modalParam === "add",
    };
  }
  if (cleanPath === ROUTES.settings) {
    return {
      view: "settings",
      gridTab: "active",
      tagFilter: "ALL",
      itemId: null,
      addModalOpen: modalParam === "add",
    };
  }
  if (cleanPath === ROUTES.addItem) {
    return {
      view: "dashboard",
      gridTab,
      tagFilter,
      itemId: null,
      addModalOpen: true,
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
      };
    }
  }

  return {
    view: "dashboard",
    gridTab,
    tagFilter,
    itemId: null,
    addModalOpen: modalParam === "add",
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
  } else if (route.view === "settings") {
    path = ROUTES.settings;
  }

  const params = new URLSearchParams();
  if (route.view === "dashboard") {
    if (route.gridTab === "bought") {
      params.set("tab", "bought");
    }
    if (route.tagFilter && route.tagFilter !== "ALL") {
      params.set("tag", route.tagFilter);
    }
  }
  if (route.addModalOpen && route.view !== "dashboard" && !route.itemId) {
    params.set("modal", "add");
  }

  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

