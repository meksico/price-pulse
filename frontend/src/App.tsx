import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PROFILE_STORAGE_KEY,
  requestGoogleAccessToken,
  STORAGE_KEY,
  type UserProfile,
} from "./shared/auth";
import {
  buildRouteUrl,
  parseRoute,
  type AppRoute,
} from "./shared/routes";
import { AddItemModal } from "./ui/AddItemModal";
import { BrandHeroLogo } from "./ui/BrandLogo";
import { Header, MobileBottomNav } from "./ui/Header";
import { ItemDetailsModal } from "./ui/ItemDetailsModal";
import { PositionsGrid } from "./ui/PositionsGrid";
import { SystemHealthView } from "./ui/SystemHealthView";
import { TagManagerView } from "./ui/TagManagerView";
import {
  ToastViewport,
  type PushToastFn,
  type ToastMessage,
} from "./ui/ToastViewport";
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [route, setRoute] = useState<AppRoute>(() =>
    parseRoute(window.location.pathname, window.location.search),
  );
  const [isChecking, setIsChecking] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimersRef = useRef<Record<string, number>>({});

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current[id];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete toastTimersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback<PushToastFn>((variant, title, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev.slice(-3), { id, variant, title, message }]);
    toastTimersRef.current[id] = window.setTimeout(() => {
      delete toastTimersRef.current[id];
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

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

  const refreshAll = useCallback(async (): Promise<boolean> => {
    if (authEnabled && !getStoredAuthToken()) {
      return false;
    }
    setIsSyncing(true);
    try {
      const [nextState, nextHealth] = await Promise.all([
        store.loadState(),
        store.getHealth().catch(() => null),
      ]);
      setState(nextState);
      if (nextHealth) {
        setDiagnostics(nextHealth);
      }
      setSyncError(null);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (authEnabled && msg.startsWith("API 401")) {
        clearStoredAuthToken();
        setAuthToken(null);
        setUserProfile(null);
        setState(null);
        setSyncError(null);
        pushToast(
          "warning",
          "Session expired",
          "Please sign in again with your Google account.",
        );
      } else {
        setSyncError(msg);
        pushToast("error", "Workspace sync failed", msg);
      }
      return false;
    } finally {
      setIsSyncing(false);
    }
  }, [authEnabled, pushToast, store]);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const token = await requestGoogleAccessToken();
      setAuthToken(token);
      setSyncError(null);
      const [profile] = await Promise.all([
        fetchGoogleUserProfile(token),
        refreshAll(),
      ]);
      if (profile) setUserProfile(profile);
      pushToast(
        "success",
        "Signed in",
        profile?.email
          ? `Connected as ${profile.email}.`
          : "Google account connected.",
      );
    } catch (err) {
      pushToast(
        "error",
        "Sign in failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = () => {
    clearStoredAuthToken();
    setAuthToken(null);
    setUserProfile(null);
    setState(null);
    setSyncError(null);
    pushToast("info", "Signed out", "Disconnected from workspace session.");
  };

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!authToken || userProfile || isSigningIn) return;
    let active = true;
    void fetchGoogleUserProfile(authToken).then((profile) => {
      if (active && profile) setUserProfile(profile);
    });
    return () => {
      active = false;
    };
  }, [authToken, userProfile, isSigningIn]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        event.key !== STORAGE_KEY &&
        event.key !== PROFILE_STORAGE_KEY &&
        event.key !== null
      ) {
        return;
      }
      const nextToken = getStoredAuthToken();
      const nextProfile = getStoredUserProfile();
      setAuthToken(nextToken);
      setUserProfile(nextProfile);
      if (nextToken) {
        setSyncError(null);
        void refreshAll();
      } else {
        setState(null);
        setSyncError(null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshAll]);

  const handleRunCheck = async () => {
    setIsChecking(true);
    pushToast(
      "info",
      "Batch check started",
      "Checking tracked product URLs...",
    );
    try {
      const result = await store.runBatchCheck();
      await refreshAll();
      const { telemetry, alerts_triggered } = result;
      if (telemetry.status === "PARTIAL") {
        pushToast(
          "warning",
          "Batch check finished with warnings",
          `${telemetry.breakdown} (${telemetry.duration_ms}ms). Check System Health for details.`,
        );
      } else {
        pushToast(
          "success",
          "Batch check complete",
          `${telemetry.breakdown}${alerts_triggered > 0 ? ` · ${alerts_triggered} alert(s) triggered` : ""} (${telemetry.duration_ms}ms).`,
        );
      }
    } catch (err) {
      pushToast(
        "error",
        "Batch check failed",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setIsChecking(false);
    }
  };

  const handleAddItem = async (payload: AddItemPayload) => {
    await store.addItem(payload);
    await refreshAll();
    pushToast("success", "Item added", `Started tracking "${payload.name}".`);
  };

  const handleAddItemsBatch = async (payloads: AddItemPayload[]) => {
    await store.addItemsBatch(payloads);
    await refreshAll();
    pushToast(
      "success",
      "Bulk items added",
      `Started tracking ${payloads.length} item${payloads.length === 1 ? "" : "s"}.`,
    );
  };

  const handleUpdateItem = async (itemId: string, payload: UpdateItemPayload) => {
    try {
      const targetName =
        payload.name ??
        state?.items.find((i) => i.item_id === itemId)?.name ??
        "Item";
      await store.updateItem(itemId, payload);
      await refreshAll();
      const tagsOnly =
        payload.tag_names !== undefined &&
        payload.name === undefined &&
        payload.target_price === undefined;
      pushToast(
        "success",
        tagsOnly ? "Item tags updated" : "Item card updated",
        tagsOnly
          ? `Updated tags for "${targetName}".`
          : `Saved changes for "${targetName}".`,
      );
    } catch (err) {
      pushToast(
        "error",
        "Update failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleBuyItem = async (itemId: string, purchasedPrice: number) => {
    try {
      const target = state?.items.find((i) => i.item_id === itemId);
      await store.markBought(itemId, purchasedPrice);
      navigate({ gridTab: "bought", itemId: null }, true);
      await refreshAll();
      pushToast(
        "success",
        "Marked as bought",
        target
          ? `Moved "${target.name}" to Bought Items at ${target.currency}${purchasedPrice.toFixed(2)}.`
          : "Moved item to Bought Items Sheet.",
      );
    } catch (err) {
      pushToast(
        "error",
        "Could not mark as bought",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleResumeItem = async (itemId: string) => {
    try {
      const target = state?.bought_items.find((i) => i.item_id === itemId);
      await store.resumeTracking(itemId);
      navigate({ gridTab: "active", itemId: null }, true);
      await refreshAll();
      pushToast(
        "success",
        "Tracking resumed",
        target
          ? `Returned "${target.name}" to Active Positions.`
          : "Returned item to Active Positions.",
      );
    } catch (err) {
      pushToast(
        "error",
        "Could not resume tracking",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    try {
      const targetName =
        state?.items.find((i) => i.item_id === itemId)?.name ??
        state?.bought_items.find((i) => i.item_id === itemId)?.name ??
        itemId;
      await store.deleteItem(itemId);
      navigate({ itemId: null }, true);
      await refreshAll();
      pushToast(
        "success",
        "Position deleted",
        `Removed "${targetName}" from tracking.`,
      );
    } catch (err) {
      pushToast(
        "error",
        "Delete failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleCreateTag = async (name: string, color: TagColor) => {
    try {
      await store.createTag(name, color);
      await refreshAll();
      pushToast("success", "Tag created", `Added tag "${name}".`);
    } catch (err) {
      pushToast(
        "error",
        "Tag creation failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleUpdateTag = async (
    tagId: string,
    updates: { name?: string; color?: TagColor },
  ) => {
    try {
      const existing = state?.tags.find((t) => t.tag_id === tagId);
      await store.updateTag(tagId, updates);
      await refreshAll();
      const label = updates.name ?? existing?.name ?? tagId;
      pushToast("success", "Tag updated", `Saved changes to "${label}".`);
    } catch (err) {
      pushToast(
        "error",
        "Tag update failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    try {
      const existingName =
        state?.tags.find((t) => t.tag_id === tagId)?.name ?? tagId;
      await store.deleteTag(tagId);
      if (activeTagFilter === tagId) navigate({ tagFilter: "ALL" }, true);
      await refreshAll();
      pushToast("success", "Tag deleted", `Removed tag "${existingName}".`);
    } catch (err) {
      pushToast(
        "error",
        "Tag deletion failed",
        err instanceof Error ? err.message : String(err),
      );
    }
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
      pushToast(
        "warning",
        "Item not found",
        `Item "${selectedItemId}" was not found.`,
      );
      navigate({ itemId: null }, true);
    }
  }, [
    state,
    selectedItemId,
    selectedActiveItem,
    selectedBoughtItem,
    navigate,
    pushToast,
  ]);

  const isUnauthenticated = authEnabled && !authToken;

  useEffect(() => {
    const retryIfNeeded = () => {
      if (
        document.visibilityState === "visible" &&
        !isUnauthenticated &&
        !state &&
        !isSyncing
      ) {
        void refreshAll();
      }
    };
    document.addEventListener("visibilitychange", retryIfNeeded);
    window.addEventListener("online", retryIfNeeded);
    return () => {
      document.removeEventListener("visibilitychange", retryIfNeeded);
      window.removeEventListener("online", retryIfNeeded);
    };
  }, [isUnauthenticated, state, isSyncing, refreshAll]);

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
      .then(() => refreshAll())
      .catch(() => {});
  }, [state, userProfile?.email, configEmail, spreadsheetId, store, refreshAll]);

  const handleSelectTopView = (view: AppRoute["view"]) => {
    navigate({
      view,
      gridTab: "active",
      tagFilter: "ALL",
      itemId: null,
      addModalOpen: false,
      addModalMode: "single",
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
          onOpenAddModal={() =>
            navigate({
              addModalOpen: true,
              addModalMode: "single",
              itemId: null,
            })
          }
          spreadsheetId={spreadsheetId}
          userName={userProfile?.name ?? ""}
          userEmail={userProfile?.email || configEmail}
          userAvatarUrl={userProfile?.picture ?? ""}
          onSignOut={authEnabled && authToken ? handleSignOut : undefined}
        />
      )}

      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 space-y-3 px-3 py-3 sm:space-y-5 sm:px-4 sm:py-5">

        {isUnauthenticated ? (
          <section
            id={ANCHORS.authGate}
            aria-label="Google Sign-In"
            className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-[340px] flex-col items-center justify-between py-8 text-center"
          >
            <div className="my-auto w-full">
              <BrandHeroLogo />
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
          isSyncing || !syncError ? (
            <div
              id={ANCHORS.workspaceSyncStatus}
              role="status"
              className="text-sm text-zinc-500"
            >
              Loading PricePulse workspace...
            </div>
          ) : (
            <div
              id={ANCHORS.workspaceSyncStatus}
              role="status"
              className="mx-auto my-8 max-w-md rounded-xl border border-gray-200 bg-white p-5 text-center sm:p-6"
            >
              <h2 className="text-base font-semibold text-zinc-950">
                Unable to load PricePulse workspace
              </h2>
              <p className="mt-1.5 break-words text-sm text-zinc-500">
                {syncError}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void refreshAll()}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-zinc-950 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
                >
                  Retry Workspace Sync
                </button>
                {authEnabled && (
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-gray-100"
                  >
                    Sign out
                  </button>
                )}
              </div>
            </div>
          )
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
                onNotify={pushToast}
              />
            )}
          </>
        )}
      </main>

      {!isUnauthenticated && !addModalOpen && !selectedItemId && (
        <MobileBottomNav
          activeView={activeView}
          onSelectView={handleSelectTopView}
          onOpenAddModal={() =>
            navigate({
              addModalOpen: true,
              addModalMode: "single",
              itemId: null,
            })
          }
        />
      )}

      <AddItemModal
        open={addModalOpen}
        mode={route.addModalMode}
        prefill={route.addPrefill}
        onModeChange={(nextMode) => navigate({ addModalMode: nextMode })}
        existingUrls={state?.items.map((item) => item.url) ?? []}
        availableTags={state?.tags ?? []}
        defaultCurrency={workspaceCurrency}
        onClose={() =>
          navigate({ addModalOpen: false, addModalMode: "single" })
        }
        onPreviewUrl={(url, onRetry) => store.previewUrl(url, onRetry)}
        onPreviewUrlsBatch={(urls, onRetry) =>
          store.previewUrlsBatch(urls, onRetry)
        }
        onSaveItem={handleAddItem}
        onSaveItemsBatch={handleAddItemsBatch}
        onNotify={pushToast}
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
        onNotify={pushToast}
      />

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
