import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalApiDataAdapter } from "./adapters/localApiAdapter";
import type {
  AddItemPayload,
  ConfigEntry,
  RuntimeDiagnostics,
  TagColor,
  UpdateItemPayload,
  WorkspaceState,
} from "./domain/models";
import { formatSavingsByCurrency } from "./domain/models";
import { ANCHORS } from "./shared/anchors";
import {
  clearStoredAuthToken,
  getStoredAuthToken,
  isGoogleAuthEnabled,
  requestGoogleAccessToken,
} from "./shared/auth";
import {
  buildRouteUrl,
  parseRoute,
  type AppRoute,
} from "./shared/routes";
import { AddItemModal } from "./ui/AddItemModal";
import { Header } from "./ui/Header";
import { ItemDetailsModal } from "./ui/ItemDetailsModal";
import { PositionsGrid } from "./ui/PositionsGrid";
import { SettingsView } from "./ui/SettingsView";
import { SystemHealthView } from "./ui/SystemHealthView";
import { TagManagerView } from "./ui/TagManagerView";
import { TrajectoryChart } from "./ui/TrajectoryChart";

export function App() {
  const authEnabled = isGoogleAuthEnabled();
  const [authToken, setAuthToken] = useState<string | null>(() =>
    getStoredAuthToken(),
  );
  const [isSigningIn, setIsSigningIn] = useState(false);
  const store = useMemo(
    () => new LocalApiDataAdapter(undefined, () => getStoredAuthToken()),
    [],
  );
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [route, setRoute] = useState<AppRoute>(() =>
    parseRoute(window.location.pathname, window.location.search),
  );
  const [isChecking, setIsChecking] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const navigate = useCallback(
    (
      updater: Partial<AppRoute> | ((prev: AppRoute) => AppRoute),
      replace = false,
    ) => {
      setRoute((prev) => {
        const next =
          typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
        const nextUrl = buildRouteUrl(next);
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (nextUrl !== currentUrl) {
          if (replace) window.history.replaceState(null, "", nextUrl);
          else window.history.pushState(null, "", nextUrl);
        }
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute(window.location.pathname, window.location.search));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const activeView = route.view;
  const gridTab = route.gridTab;
  const activeTagFilter = route.tagFilter;
  const addModalOpen = route.addModalOpen;
  const selectedItemId = route.itemId;

  const refreshAll = useCallback(async () => {
    if (authEnabled && !getStoredAuthToken()) {
      return;
    }
    setErrorBanner(null);
    try {
      const [nextState, nextHealth] = await Promise.all([
        store.loadState(),
        store.getHealth(),
      ]);
      setState(nextState);
      setDiagnostics(nextHealth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (authEnabled && msg.startsWith("API 401")) {
        clearStoredAuthToken();
        setAuthToken(null);
        setState(null);
      }
      setErrorBanner(msg);
    }
  }, [authEnabled, store]);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setErrorBanner(null);
    try {
      const token = await requestGoogleAccessToken();
      setAuthToken(token);
      await refreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = () => {
    clearStoredAuthToken();
    setAuthToken(null);
    setState(null);
    setErrorBanner(null);
  };

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleRunCheck = async () => {
    setIsChecking(true);
    try {
      await store.runBatchCheck();
      await refreshAll();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsChecking(false);
    }
  };

  const handleAddItem = async (payload: AddItemPayload) => {
    await store.addItem(payload);
    await refreshAll();
  };

  const handleUpdateItem = async (itemId: string, payload: UpdateItemPayload) => {
    await store.updateItem(itemId, payload);
    await refreshAll();
  };

  const handleBuyItem = async (itemId: string, purchasedPrice: number) => {
    await store.markBought(itemId, purchasedPrice);
    navigate({ gridTab: "bought", itemId: null }, true);
    await refreshAll();
  };

  const handleResumeItem = async (itemId: string) => {
    await store.resumeTracking(itemId);
    navigate({ gridTab: "active", itemId: null }, true);
    await refreshAll();
  };

  const handleDeleteItem = async (itemId: string) => {
    await store.deleteItem(itemId);
    navigate({ itemId: null }, true);
    await refreshAll();
  };

  const handleCreateTag = async (name: string, color: TagColor) => {
    await store.createTag(name, color);
    await refreshAll();
  };

  const handleUpdateTag = async (
    tagId: string,
    updates: { name?: string; color?: TagColor },
  ) => {
    await store.updateTag(tagId, updates);
    await refreshAll();
  };

  const handleDeleteTag = async (tagId: string) => {
    await store.deleteTag(tagId);
    if (activeTagFilter === tagId) navigate({ tagFilter: "ALL" }, true);
    await refreshAll();
  };

  const handleSaveConfig = async (entries: ConfigEntry[]) => {
    await store.saveConfig(entries);
    await refreshAll();
  };

  const spreadsheetId =
    state?.config.find((c) => c.key === "spreadsheet_id")?.value ?? "";
  const latestRun = state?.telemetry_logs[0];
  const totalSavedText = formatSavingsByCurrency(state?.bought_items ?? []);

  const selectedActiveItem =
    state?.items.find((i) => i.item_id === selectedItemId) ?? null;
  const selectedBoughtItem =
    state?.bought_items.find((b) => b.item_id === selectedItemId) ?? null;
  const selectedSnapshots =
    state?.price_history.filter((s) => s.item_id === selectedItemId) ?? [];

  useEffect(() => {
    if (
      state &&
      selectedItemId &&
      !selectedActiveItem &&
      !selectedBoughtItem
    ) {
      setErrorBanner(`Item "${selectedItemId}" was not found.`);
      navigate({ itemId: null }, true);
    }
  }, [state, selectedItemId, selectedActiveItem, selectedBoughtItem, navigate]);

  return (
    <div className="pp-page-shell w-full bg-slate-950 text-slate-100">
      <Header
        activeView={activeView}
        onSelectView={(view) =>
          navigate({
            view,
            gridTab: "active",
            tagFilter: "ALL",
            itemId: null,
            addModalOpen: false,
          })
        }
        activeItemCount={state?.items.length ?? 0}
        tagCount={state?.tags.length ?? 0}
        isChecking={isChecking}
        onRunCheck={() => void handleRunCheck()}
        onOpenAddModal={() => navigate({ addModalOpen: true, itemId: null })}
        spreadsheetId={spreadsheetId}
        onSignOut={authEnabled && authToken ? handleSignOut : undefined}
      />

      <main className="mx-auto w-full max-w-7xl min-w-0 space-y-3 px-3 py-3 sm:space-y-5 sm:px-4 sm:py-5">
        {errorBanner && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200"
          >
            {errorBanner}
          </div>
        )}

        {authEnabled && !authToken ? (
          <section
            id={ANCHORS.authGate}
            aria-label="Google Sign-In"
            className="mx-auto mt-8 max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-center shadow-xl"
          >
            <h1 className="text-lg font-semibold text-slate-100">
              Sign in to PricePulse
            </h1>
            <p className="mt-2 text-xs text-slate-400">
              Sign in with an authorized Google account to access your tracked
              products and live price history.
            </p>
            <button
              type="button"
              onClick={() => void handleSignIn()}
              disabled={isSigningIn}
              aria-busy={isSigningIn}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {isSigningIn ? "Signing in..." : "Sign in with Google"}
            </button>
          </section>
        ) : !state ? (
          <div role="status" className="text-sm text-slate-400">
            Loading PricePulse workspace...
          </div>
        ) : (
          <>
            {activeView === "dashboard" && (
              <section
                id={ANCHORS.viewDashboard}
                aria-label="Dashboard"
                className="flex min-w-0 flex-col gap-3 sm:gap-5"
              >
                <div className="order-3 @container grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 md:order-1">
                  <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:rounded-2xl sm:p-4">
                    <div className="truncate text-[11px] text-slate-400 sm:text-xs">
                      Active Monitoring
                    </div>
                    <div className="pp-kpi-value mt-0.5 font-bold text-slate-100">
                      {state.items.length}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-emerald-400 sm:text-xs">
                      &bull; {state.tags.length} Tags &bull; {state.items.length}{" "}
                      Tracked
                    </div>
                  </div>
                  <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:rounded-2xl sm:p-4">
                    <div className="truncate text-[11px] text-slate-400 sm:text-xs">
                      Total Saved Costs
                    </div>
                    <div className="pp-kpi-value mt-0.5 truncate font-bold text-emerald-400">
                      {totalSavedText}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400 sm:text-xs">
                      {state.bought_items.length} bought items
                    </div>
                  </div>
                  <div className="col-span-2 min-w-0 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:col-span-1 sm:rounded-2xl sm:p-4">
                    <div className="flex items-center justify-between gap-2 sm:block">
                      <div className="truncate text-[11px] text-slate-400 sm:text-xs">
                        Engine Health
                      </div>
                      <div className="pp-kpi-value font-bold text-slate-100 sm:mt-0.5">
                        {latestRun?.status ?? "READY"}
                      </div>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400 sm:text-xs">
                      {latestRun
                        ? `${latestRun.breakdown} (${latestRun.duration_ms}ms)`
                        : "Awaiting first batch check"}
                    </div>
                  </div>
                </div>

                <div className="order-1 min-w-0 md:order-2">
                  <TrajectoryChart
                    items={state.items}
                    tags={state.tags}
                    priceHistory={state.price_history}
                    activeTagFilter={activeTagFilter}
                    onTagFilterChange={(tagFilter) => navigate({ tagFilter })}
                  />
                </div>

                <div className="order-2 min-w-0 md:order-3">
                  <PositionsGrid
                    items={state.items}
                    boughtItems={state.bought_items}
                    tags={state.tags}
                    priceHistory={state.price_history}
                    activeTab={gridTab}
                    onTabChange={(nextTab) => navigate({ gridTab: nextTab })}
                    activeTagFilter={activeTagFilter}
                    onTagFilterChange={(tagFilter) => navigate({ tagFilter })}
                    onOpenItem={(itemId) =>
                      navigate({ itemId, addModalOpen: false })
                    }
                    onOpenAddModal={() =>
                      navigate({ addModalOpen: true, itemId: null })
                    }
                  />
                </div>
              </section>
            )}

            {activeView === "tags" && (
              <TagManagerView
                tags={state.tags}
                items={state.items}
                boughtItems={state.bought_items}
                onCreateTag={handleCreateTag}
                onUpdateTag={handleUpdateTag}
                onDeleteTag={handleDeleteTag}
                onViewInGrid={(tagId) =>
                  navigate({
                    view: "dashboard",
                    gridTab: "active",
                    tagFilter: tagId,
                    itemId: null,
                    addModalOpen: false,
                  })
                }
              />
            )}

            {activeView === "health" && (
              <SystemHealthView
                telemetryLogs={state.telemetry_logs}
                diagnostics={diagnostics}
                isChecking={isChecking}
                onRunCheck={() => void handleRunCheck()}
              />
            )}

            {activeView === "settings" && (
              <SettingsView
                config={state.config}
                onSaveConfig={handleSaveConfig}
                onBootstrapSheets={() => store.bootstrapSheets()}
              />
            )}
          </>
        )}
      </main>

      <AddItemModal
        open={addModalOpen}
        onClose={() => navigate({ addModalOpen: false })}
        onPreviewUrl={(url) => store.previewUrl(url)}
        onSaveItem={handleAddItem}
      />

      <ItemDetailsModal
        activeItem={selectedActiveItem}
        boughtItem={selectedBoughtItem}
        tags={state?.tags ?? []}
        snapshots={selectedSnapshots}
        onClose={() => navigate({ itemId: null })}
        onUpdateItem={handleUpdateItem}
        onBuyItem={handleBuyItem}
        onResumeItem={handleResumeItem}
        onDeleteItem={handleDeleteItem}
      />
    </div>
  );
}
