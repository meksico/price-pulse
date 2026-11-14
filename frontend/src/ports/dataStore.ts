import type {
  AddItemPayload,
  BoughtItem,
  ConfigEntry,
  RuntimeDiagnostics,
  ScrapePreview,
  Tag,
  TagColor,
  TelemetryRun,
  TrackedItem,
  UpdateItemPayload,
  WorkspaceState,
} from "../domain/models";

export interface DataStorePort {
  loadState(): Promise<WorkspaceState>;
  getHealth(): Promise<RuntimeDiagnostics>;
  previewUrl(url: string): Promise<ScrapePreview>;
  addItem(payload: AddItemPayload): Promise<TrackedItem>;
  updateItem(itemId: string, payload: UpdateItemPayload): Promise<TrackedItem>;
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

