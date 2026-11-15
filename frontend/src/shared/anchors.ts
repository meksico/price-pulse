/**
 * Centralized BEM Anchor Registry (RULE-BEM-ID / REQ-A11Y-02).
 * Single source of truth for structural landmark, panel, form, and modal IDs.
 */
export const ANCHORS = {
  authGate: "auth-gate",
  viewDashboard: "view-dashboard",
  viewTags: "view-tags",
  viewHealth: "view-health",
  mobileNavDrawer: "header__mobile-nav",
  mobileBottomNav: "mobile-bottom-nav",
  userDropdownMenu: "user-dropdown-menu",
  chartPanel: "chart-panel",
  chartPanelControls: "chart-panel__controls",
  chartCategoryFilter: "chart-category-filter",
  chartSeriesCheckboxes: "chart-series-checkboxes",
  gridPanel: "grid-panel",
  gridPanelToolbar: "grid-panel__toolbar",
  gridPanelTagBar: "grid-panel__tag-bar",
  modalAddItem: "modal-add-item",
  modalAddItemModeTabs: "modal-add-item__mode-tabs",
  modalAddItemLoadingOverlay: "modal-add-item__loading-overlay",
  modalAddItemReviewCarousel: "modal-add-item__review-carousel",
  modalAddItemBulkSummary: "modal-add-item__bulk-summary",
  modalItemDetails: "modal-item-details",
  modalItemDetailsLoadingOverlay: "modal-item-details__loading-overlay",
  modalTelemetryJson: "modal-telemetry-json",
  toastViewport: "toast-viewport",
  workspaceSyncStatus: "workspace-sync-status",
} as const;

export type AnchorId = (typeof ANCHORS)[keyof typeof ANCHORS];

