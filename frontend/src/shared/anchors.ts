/**
 * Centralized BEM Anchor Registry (RULE-BEM-ID / REQ-A11Y-02).
 * Single source of truth for structural landmark, panel, form, and modal IDs.
 */
export const ANCHORS = {
  authGate: "auth-gate",
  viewDashboard: "view-dashboard",
  viewTags: "view-tags",
  viewHealth: "view-health",
  viewSettings: "view-settings",
  mobileNavDrawer: "header__mobile-nav",
  userDropdownMenu: "user-dropdown-menu",
  chartPanel: "chart-panel",
  chartPanelControls: "chart-panel__controls",
  chartCategoryFilter: "chart-category-filter",
  chartSeriesCheckboxes: "chart-series-checkboxes",
  gridPanel: "grid-panel",
  gridPanelToolbar: "grid-panel__toolbar",
  gridPanelTagBar: "grid-panel__tag-bar",
  modalAddItem: "modal-add-item",
  modalItemDetails: "modal-item-details",
} as const;

export type AnchorId = (typeof ANCHORS)[keyof typeof ANCHORS];

