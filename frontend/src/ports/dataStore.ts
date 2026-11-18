import type {
  AddItemPayload,
  BatchPreviewItemResult,
  BoughtItem,
  BulkTagAction,
  ConfigEntry,
  ResourcesInventory,
  RuntimeDiagnostics,
  ScrapePreview,
  Tag,
  TagColor,
  TelemetryRun,
  TrackedItem,
  UpdateItemPayload,
  WorkspaceState,
} from "../domain/models";

export interface RetryAttemptInfo {
  nextAttempt: number;
  maxAttempts: number;
  status?: number;
  reason: string;
}

export type RequestRetryCallback = (info: RetryAttemptInfo) => void;

export interface DataStorePort {
  loadState(): Promise<WorkspaceState>;
  getHealth(): Promise<RuntimeDiagnostics>;
  getResources(): Promise<ResourcesInventory>;
  probeResources(): Promise<ResourcesInventory>;
  previewUrl(
    url: string,
    onRetry?: RequestRetryCallback,
  ): Promise<ScrapePreview>;
  previewUrlsBatch(
    urls: string[],
    onRetry?: RequestRetryCallback,
  ): Promise<BatchPreviewItemResult[]>;
  addItem(payload: AddItemPayload): Promise<TrackedItem>;
  addItemsBatch(items: AddItemPayload[]): Promise<TrackedItem[]>;
  updateItem(itemId: string, payload: UpdateItemPayload): Promise<TrackedItem>;
  recheckItem(itemId: string): Promise<TrackedItem>;
  bulkUpdateTags(
    itemIds: string[],
    action: BulkTagAction,
    tagNames: string[],
  ): Promise<TrackedItem[]>;
  bulkRecheckItems(
    itemIds: string[],
  ): Promise<{ telemetry: TelemetryRun; alerts_triggered: number }>;
  bulkDeleteItems(itemIds: string[]): Promise<string[]>;
  markBought(itemId: string, purchasedPrice: number): Promise<BoughtItem>;
  resumeTracking(itemId: string): Promise<TrackedItem>;
  deleteItem(itemId: string): Promise<void>;
  createTag(name: string, color: TagColor): Promise<Tag>;
  updateTag(
    tagId: string,
    updates: { name?: string; color?: TagColor },
  ): Promise<Tag>;
  deleteTag(tagId: string): Promise<void>;
  runBatchCheck(): Promise<{ telemetry: TelemetryRun; alerts_triggered: number }>;
  saveConfig(entries: ConfigEntry[]): Promise<ConfigEntry[]>;
  bootstrapSheets(): Promise<string[]>;
}

