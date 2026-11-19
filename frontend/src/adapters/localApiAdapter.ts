import type {
  AddItemPayload,
  BatchCheckResult,
  BatchCheckStreamEvent,
  BatchPreviewItemResult,
  BatchPreviewResponse,
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
import type { DataStorePort, RequestRetryCallback } from "../ports/dataStore";
import { waitForDocumentVisible } from "../shared/auth";

const RETRY_DELAYS_MS = [350, 800] as const;
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function isTransientNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /load failed|failed to fetch|networkerror/i.test(msg);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

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

  private async request<T>(
    path: string,
    init?: RequestInit,
    onRetry?: RequestRetryCallback,
    maxAttempts = 3,
  ): Promise<T> {
    const token = this.getAuthToken?.();
    const headers: Record<string, string> = {
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token && path !== "/api/health"
        ? { Authorization: `Bearer ${token}` }
        : {}),
    };
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await waitForDocumentVisible(600);
      try {
        const resp = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: {
            ...headers,
            ...(init?.headers as Record<string, string> | undefined),
          },
        });
        if (resp.ok) {
          return (await resp.json()) as T;
        }
        if (
          RETRYABLE_STATUSES.has(resp.status) &&
          attempt < maxAttempts - 1
        ) {
          onRetry?.({
            nextAttempt: attempt + 2,
            maxAttempts,
            status: resp.status,
            reason: `HTTP ${resp.status}`,
          });
          await delayMs(RETRY_DELAYS_MS[attempt] ?? 800);
          continue;
        }
        const text = await resp.text();
        throw new Error(`API ${resp.status}: ${text}`);
      } catch (err) {
        lastError = err;
        if (isTransientNetworkError(err) && attempt < maxAttempts - 1) {
          onRetry?.({
            nextAttempt: attempt + 2,
            maxAttempts,
            reason: err instanceof Error ? err.message : "Network error",
          });
          await delayMs(RETRY_DELAYS_MS[attempt] ?? 800);
          continue;
        }
        throw err;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Request failed after retries.");
  }

  loadState(): Promise<WorkspaceState> {
    return this.request<WorkspaceState>("/api/state");
  }

  getHealth(): Promise<RuntimeDiagnostics> {
    return this.request<RuntimeDiagnostics>("/api/health");
  }

  getResources(): Promise<ResourcesInventory> {
    return this.request<ResourcesInventory>("/api/resources");
  }

  probeResources(): Promise<ResourcesInventory> {
    return this.request<ResourcesInventory>("/api/resources/probe", {
      method: "POST",
    });
  }

  previewUrl(
    url: string,
    onRetry?: RequestRetryCallback,
  ): Promise<ScrapePreview> {
    return this.request<ScrapePreview>(
      "/api/scrape/preview",
      {
        method: "POST",
        body: JSON.stringify({ url }),
      },
      onRetry,
    );
  }

  async previewUrlsBatch(
    urls: string[],
    onRetry?: RequestRetryCallback,
  ): Promise<BatchPreviewItemResult[]> {
    const res = await this.request<BatchPreviewResponse>(
      "/api/scrape/preview-batch",
      {
        method: "POST",
        body: JSON.stringify({ urls }),
      },
      onRetry,
    );
    return res.results;
  }

  addItem(payload: AddItemPayload): Promise<TrackedItem> {
    return this.request<TrackedItem>("/api/items", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async addItemsBatch(items: AddItemPayload[]): Promise<TrackedItem[]> {
    const res = await this.request<{ items: TrackedItem[] }>(
      "/api/items/batch",
      {
        method: "POST",
        body: JSON.stringify({ items }),
      },
    );
    return res.items;
  }

  updateItem(itemId: string, payload: UpdateItemPayload): Promise<TrackedItem> {
    return this.request<TrackedItem>(`/api/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async recheckItem(itemId: string): Promise<TrackedItem> {
    // Non-idempotent live scrape / Gemini grounding: never auto-retry on 504.
    const res = await this.request<{ item: TrackedItem }>(
      `/api/items/${encodeURIComponent(itemId)}/recheck`,
      { method: "POST" },
      undefined,
      1,
    );
    return res.item;
  }

  async bulkUpdateTags(
    itemIds: string[],
    action: BulkTagAction,
    tagNames: string[],
  ): Promise<TrackedItem[]> {
    const res = await this.request<{ items: TrackedItem[] }>(
      "/api/items/bulk-tags",
      {
        method: "POST",
        body: JSON.stringify({
          item_ids: itemIds,
          action,
          tag_names: tagNames,
        }),
      },
    );
    return res.items;
  }

  bulkRecheckItems(
    itemIds: string[],
  ): Promise<{ telemetry: TelemetryRun; alerts_triggered: number }> {
    return this.request(
      "/api/items/bulk-recheck",
      {
        method: "POST",
        body: JSON.stringify({ item_ids: itemIds }),
      },
      undefined,
      1,
    );
  }

  async bulkDeleteItems(itemIds: string[]): Promise<string[]> {
    const res = await this.request<{ deleted_ids: string[] }>(
      "/api/items/bulk-delete",
      {
        method: "POST",
        body: JSON.stringify({ item_ids: itemIds }),
      },
    );
    return res.deleted_ids;
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
    // Non-idempotent long-running batch: never auto-retry on 504 to avoid double-billing.
    return this.request("/api/scrape/run-check", { method: "POST" }, undefined, 1);
  }

  async runBatchCheckStream(
    onEvent: (event: BatchCheckStreamEvent) => void,
  ): Promise<BatchCheckResult> {
    await waitForDocumentVisible(600);
    const token = this.getAuthToken?.();
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    const resp = await fetch(`${this.baseUrl}/api/scrape/run-check/stream`, {
      method: "POST",
      headers,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`API ${resp.status}: ${text}`);
    }
    if (!resp.body) {
      const fallback = await this.runBatchCheck();
      return fallback;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let finalResult: BatchCheckResult | null = null;

    const processLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return;
      const jsonText = line.slice(5).trim();
      if (!jsonText) return;
      const event = JSON.parse(jsonText) as BatchCheckStreamEvent;
      onEvent(event);
      if (event.type === "complete") {
        finalResult = {
          telemetry: event.telemetry,
          alerts_triggered: event.alerts_triggered,
          digest_sent: event.digest_sent,
          captcha_report_sent: event.captcha_report_sent,
        };
      } else if (event.type === "error") {
        throw new Error(event.detail || "Streaming batch check failed");
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    }
    if (buffer.trim()) {
      processLine(buffer);
    }
    if (!finalResult) {
      throw new Error("Batch check stream ended without a completion event");
    }
    return finalResult;
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

