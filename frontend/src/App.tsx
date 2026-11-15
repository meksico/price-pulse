import { useCallback, useEffect, useMemo, useState } from "react";
import { LocalApiDataAdapter } from "./adapters/localApiAdapter";
import type {
  AddItemPayload,
  RuntimeDiagnostics,
  TagColor,
  UpdateItemPayload,
  WorkspaceState,
} from "./domain/models";
import { formatSavingsByCurrency } from "./domain/models";
import { ANCHORS } from "./shared/anchors";
import {
  clearStoredAuthToken,
  fetchGoogleUserProfile,
  getStoredAuthToken,
  getStoredUserProfile,
  isGoogleAuthEnabled,
  requestGoogleAccessToken,
  type UserProfile,
} from "./shared/auth";
import {
  buildRouteUrl,
  parseRoute,
  type AppRoute,
} from "./shared/routes";
import { AddItemModal } from "./ui/AddItemModal";
import { Header, MobileBottomNav } from "./ui/Header";
import { ItemDetailsModal } from "./ui/ItemDetailsModal";
import { PositionsGrid } from "./ui/PositionsGrid";
import { SystemHealthView } from "./ui/SystemHealthView";
import { TagManagerView } from "./ui/TagManagerView";
import { TrajectoryChart } from "./ui/TrajectoryChart";

export function App() {
  const authEnabled = isGoogleAuthEnabled();
  const [authToken, setAuthToken] = useState<string | null>(() =>
    getStoredAuthToken(),
  );
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() =>
    getStoredUserProfile(),
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
        setUserProfile(null);
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
      const [profile] = await Promise.all([
        fetchGoogleUserProfile(token),
        refreshAll(),
      ]);
      if (profile) setUserProfile(profile);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = () => {
    clearStoredAuthToken();
    setAuthToken(null);
    setUserProfile(null);
    setState(null);
    setErrorBanner(null);
  };

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!authToken || userProfile) return;
    let active = true;
    void fetchGoogleUserProfile(authToken).then((profile) => {
      if (active && profile) setUserProfile(profile);
    });
    return () => {
      active = false;
    };
  }, [authToken, userProfile]);

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

  const spreadsheetId =
    state?.config.find((c) => c.key === "spreadsheet_id")?.value ?? "";
  const configEmail =
    state?.config.find((c) => c.key === "gmail_alert_recipient")?.value?.trim() ??
    "";
  const latestRun = state?.telemetry_logs[0];
  const workspaceCurrency =
    state?.items[0]?.currency ?? state?.bought_items[0]?.currency ?? "₴";
  const totalSavedText = formatSavingsByCurrency(
    state?.bought_items ?? [],
    workspaceCurrency,
  );
  const anomalyRunCount = (state?.telemetry_logs ?? []).filter(
    (run) => run.status !== "SUCCESS",
  ).length;

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

  const isUnauthenticated = authEnabled && !authToken;

  useEffect(() => {
    if (!state || !userProfile?.email) return;
    if (configEmail === userProfile.email) return;
    void store
      .saveConfig([
        {
          key: "spreadsheet_id",
          value: spreadsheetId,
          description: "Google Sheets Workbook ID",
        },
        {
          key: "gmail_alert_recipient",
          value: userProfile.email,
          description: "Recipient for target_price discount digests",
        },
        {
          key: "poll_interval_hours",
          value: "24",
          description: "Cloud Scheduler polling cadence in hours",
        },
      ])
      .then(() => refreshAll());
  }, [state, userProfile?.email, configEmail, spreadsheetId, store, refreshAll]);

  const handleSelectTopView = (view: AppRoute["view"]) => {
    navigate({
      view,
      gridTab: "active",
      tagFilter: "ALL",
      itemId: null,
      addModalOpen: false,
    });
  };

  const scrollToGrid = (nextTab: "active" | "bought") => {
    navigate({ gridTab: nextTab });
    document
      .getElementById(ANCHORS.gridPanel)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="pp-page-shell flex w-full flex-col bg-white text-zinc-950">
      {!isUnauthenticated && (
        <Header
          activeView={activeView}
          onSelectView={handleSelectTopView}
          activeItemCount={state?.items.length ?? 0}
          tagCount={state?.tags.length ?? 0}
          isChecking={isChecking}
          onRunCheck={() => void handleRunCheck()}
          onOpenAddModal={() => navigate({ addModalOpen: true, itemId: null })}
          spreadsheetId={spreadsheetId}
          userName={userProfile?.name ?? ""}
          userEmail={userProfile?.email || configEmail}
          userAvatarUrl={userProfile?.picture ?? ""}
          onSignOut={authEnabled && authToken ? handleSignOut : undefined}
        />
      )}

      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 space-y-3 px-3 py-3 sm:space-y-5 sm:px-4 sm:py-5">
        {errorBanner && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
          >
            {errorBanner}
          </div>
        )}

        {isUnauthenticated ? (
          <section
            id={ANCHORS.authGate}
            aria-label="Google Sign-In"
            className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-[340px] flex-col items-center justify-between py-8 text-center"
          >
            <div className="my-auto w-full">
              <div className="mb-8 text-[26px] font-bold tracking-tight text-zinc-950">
                PricePulse
              </div>
              <h1 className="text-[17px] font-semibold text-zinc-950">
                Sign in to your workspace
              </h1>

              <div className="my-5 h-px w-full bg-gray-200" />

              <button
                type="button"
                onClick={() => void handleSignIn()}
                disabled={isSigningIn}
                aria-busy={isSigningIn}
                className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-lg bg-gray-100 px-4 text-[15px] font-medium text-zinc-950 transition-colors hover:bg-gray-200 disabled:opacity-40"
              >
                <svg
                  aria-hidden="true"
                  className="h-[18px] w-[18px]"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="#4285F4"
                    d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 01-2.4 3.62v3.01h3.88c2.27-2.09 3.56-5.17 3.56-8.82z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.96H1.28v3.1A12 12 0 0012 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27a7.2 7.2 0 010-4.54V6.63H1.28a12 12 0 000 10.74l4-3.1z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.69 1.28 6.63l4 3.1c.95-2.85 3.6-4.96 6.72-4.96z"
                  />
                </svg>
                {isSigningIn ? "Signing in..." : "Continue with Google"}
              </button>
            </div>

            <p className="max-w-[280px] text-[11px] leading-relaxed text-zinc-400">
              Authorized Google account required for{" "}
              <span className="font-medium text-zinc-950">Sheets Sync</span> and{" "}
              <span className="font-medium text-zinc-950">Gmail Alerts</span>.
            </p>
          </section>
        ) : !state ? (
          <div role="status" className="text-sm text-zinc-500">
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
                  <button
                    type="button"
                    onClick={() => scrollToGrid("active")}
                    className="min-w-0 rounded-xl border border-gray-200 bg-white p-3.5 text-left transition-colors hover:border-gray-300 hover:bg-gray-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 sm:p-4"
                  >
                    <div className="truncate text-xs font-medium text-zinc-950">
                      Active Monitoring
                    </div>
                    <div className="pp-kpi-value tabular-nums mt-1 font-bold tracking-tight text-zinc-950">
                      {state.items.length}
                    </div>
                    <div className="tabular-nums mt-0.5 truncate text-[11px] text-zinc-500">
                      {state.tags.length} Tags &bull; {state.items.length}{" "}
                      Tracked
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollToGrid("bought")}
                    className="min-w-0 rounded-xl border border-gray-200 bg-white p-3.5 text-left transition-colors hover:border-gray-300 hover:bg-gray-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 sm:p-4"
                  >
                    <div className="truncate text-xs font-medium text-zinc-950">
                      Total Saved Costs
                    </div>
                    <div className="pp-kpi-value tabular-nums mt-1 truncate font-bold tracking-tight text-zinc-950">
                      {totalSavedText}
                    </div>
                    <div className="tabular-nums mt-0.5 truncate text-[11px] text-zinc-500">
                      {state.bought_items.length} bought items
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectTopView("health")}
                    className="col-span-2 min-w-0 rounded-xl border border-gray-200 bg-white p-3.5 text-left transition-colors hover:border-gray-300 hover:bg-gray-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 sm:col-span-1 sm:p-4"
                  >
                    <div className="flex items-center justify-between gap-2 sm:block">
                      <div className="truncate text-xs font-medium text-zinc-950">
                        Engine Health
                      </div>
                      <div className="pp-kpi-value tabular-nums font-bold tracking-tight text-zinc-950 sm:mt-1">
                        {latestRun?.status ?? "READY"}
                      </div>
                    </div>
                    <div className="tabular-nums mt-0.5 truncate text-[11px] text-zinc-500">
                      {latestRun
                        ? `${latestRun.breakdown} (${latestRun.duration_ms}ms)`
                        : "Awaiting first batch check"}
                    </div>
                  </button>
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
                  />
                </div>
              </section>
            )}

            {activeView === "tags" && (
              <TagManagerView
                tags={state.tags}
                items={state.items}
                boughtItems={state.bought_items}
                workspaceCurrency={workspaceCurrency}
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
              />
            )}
          </>
        )}
      </main>

      {!isUnauthenticated && !addModalOpen && !selectedItemId && (
        <MobileBottomNav
          activeView={activeView}
          anomalyCount={anomalyRunCount}
          onSelectView={handleSelectTopView}
          onOpenAddModal={() => navigate({ addModalOpen: true, itemId: null })}
        />
      )}

      <AddItemModal
        open={addModalOpen}
        availableTags={state?.tags ?? []}
        defaultCurrency={workspaceCurrency}
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
