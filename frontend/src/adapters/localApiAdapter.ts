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
import type { DataStorePort } from "../ports/dataStore";

export class LocalApiDataAdapter implements DataStorePort {
  private readonly baseUrl: string;
  private readonly getAuthToken?: () => string | null;

  constructor(
    baseUrl =
      import.meta.env.VITE_API_BASE_URL ??
      (import.meta.env.DEV ? "http://127.0.0.1:8000" : ""),
    getAuthToken?: () => string | null,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.getAuthToken = getAuthToken;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.getAuthToken?.();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API ${resp.status}: ${text}`);
    }
    return (await resp.json()) as T;
  }

  loadState(): Promise<WorkspaceState> {
    return this.request<WorkspaceState>("/api/state");
  }

  getHealth(): Promise<RuntimeDiagnostics> {
    return this.request<RuntimeDiagnostics>("/api/health");
  }

  previewUrl(url: string): Promise<ScrapePreview> {
    return this.request<ScrapePreview>("/api/scrape/preview", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  addItem(payload: AddItemPayload): Promise<TrackedItem> {
    return this.request<TrackedItem>("/api/items", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  updateItem(itemId: string, payload: UpdateItemPayload): Promise<TrackedItem> {
    return this.request<TrackedItem>(`/api/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  markBought(itemId: string, purchasedPrice: number): Promise<BoughtItem> {
    return this.request<BoughtItem>(`/api/items/${itemId}/buy`, {
      method: "POST",
      body: JSON.stringify({ purchased_price: purchasedPrice }),
    });
  }

  resumeTracking(itemId: string): Promise<TrackedItem> {
    return this.request<TrackedItem>(`/api/items/${itemId}/resume`, {
      method: "POST",
    });
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.request(`/api/items/${itemId}`, { method: "DELETE" });
  }

  createTag(name: string, color: TagColor): Promise<Tag> {
    return this.request<Tag>("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name, color }),
    });
  }

  updateTag(
    tagId: string,
    updates: { name?: string; color?: TagColor },
  ): Promise<Tag> {
    return this.request<Tag>(`/api/tags/${tagId}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async deleteTag(tagId: string): Promise<void> {
    await this.request(`/api/tags/${tagId}`, { method: "DELETE" });
  }

  runBatchCheck(): Promise<{ telemetry: TelemetryRun; alerts_triggered: number }> {
    return this.request("/api/scrape/run-check", { method: "POST" });
  }

  async saveConfig(entries: ConfigEntry[]): Promise<ConfigEntry[]> {
    const res = await this.request<{ config: ConfigEntry[] }>("/api/config", {
      method: "PUT",
      body: JSON.stringify({ entries }),
    });
    return res.config;
  }

  async bootstrapSheets(): Promise<string[]> {
    const res = await this.request<{ initialized_tabs: string[] }>(
      "/api/sheets/bootstrap",
      { method: "POST" },
    );
    return res.initialized_tabs;
  }
}

