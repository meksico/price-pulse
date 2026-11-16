import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AddItemPayload,
  BatchPreviewItemResult,
  ScrapePreview,
  Tag,
} from "../domain/models";
import { ANCHORS } from "../shared/anchors";
import type { RequestRetryCallback } from "../ports/dataStore";
import type { AddModalMode, AddModalPrefill } from "../shared/routes";
import { useBottomSheetSwipeDismiss } from "../shared/useBottomSheetSwipeDismiss";
import { TagAdderControl } from "./TagAdderControl";
import type { PushToastFn } from "./ToastViewport";

const MAX_BULK_URLS = 20;
const MANUAL_CHECK_TAG = "manual check";
const SWIPE_ACTIVATION_PX = 8;
const SWIPE_COMMIT_PX = 48;

interface AddItemModalProps {
  open: boolean;
  mode?: AddModalMode;
  prefill?: AddModalPrefill | null;
  onModeChange?: (mode: AddModalMode) => void;
  existingUrls?: string[];
  availableTags?: Tag[];
  defaultCurrency?: string;
  onClose: () => void;
  onPreviewUrl: (
    url: string,
    onRetry?: RequestRetryCallback,
  ) => Promise<ScrapePreview>;
  onPreviewUrlsBatch?: (
    urls: string[],
    onRetry?: RequestRetryCallback,
  ) => Promise<BatchPreviewItemResult[]>;
  onSaveItem: (payload: AddItemPayload) => Promise<void>;
  onSaveItemsBatch?: (payloads: AddItemPayload[]) => Promise<void>;
  onNotify?: PushToastFn;
}

interface ParsedBulkUrls {
  validUrls: string[];
  alreadyTracked: string[];
  duplicates: string[];
  invalid: string[];
  overflowCount: number;
}

interface BulkDraftCard {
  id: string;
  url: string;
  title: string;
  imageUrl: string;
  currency: string;
  initialPrice: string;
  targetPrice: string;
  tagNames: string[];
  included: boolean;
  extractionTier: string;
}

interface BulkFailedOutcome {
  url: string;
  error: string;
}

interface BulkSavedSummary {
  url: string;
  name: string;
  currency: string;
  price: number;
  targetPrice: number;
}

type BulkStep = "input" | "review" | "summary";

function normalizeUrlForCompare(raw: string): string {
  try {
    const parsed = new URL(raw.trim());
    const cleanPath =
      parsed.pathname.length > 1 && parsed.pathname.endsWith("/")
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${cleanPath}${parsed.search}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export function parseBulkUrls(
  raw: string,
  existingUrls: string[],
): ParsedBulkUrls {
  const tokens = raw
    .split(/[\r\n,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const existingSet = new Set(existingUrls.map(normalizeUrlForCompare));
  const seenInBatch = new Set<string>();
  const allValid: string[] = [];
  const alreadyTracked: string[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];

  for (const token of tokens) {
    let parsed: URL | null = null;
    try {
      const candidate = new URL(token);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") {
        parsed = candidate;
      }
    } catch {
      parsed = null;
    }

    if (!parsed) {
      invalid.push(token);
      continue;
    }

    const norm = normalizeUrlForCompare(parsed.toString());
    if (seenInBatch.has(norm)) {
      duplicates.push(token);
      continue;
    }
    seenInBatch.add(norm);

    if (existingSet.has(norm)) {
      alreadyTracked.push(token);
      continue;
    }
    allValid.push(token);
  }

  return {
    validUrls: allValid.slice(0, MAX_BULK_URLS),
    alreadyTracked,
    duplicates,
    invalid,
    overflowCount: Math.max(0, allValid.length - MAX_BULK_URLS),
  };
}

function mergeUniqueTags(baseTags: string[], suggestedTags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...baseTags, ...suggestedTags]) {
    const clean = raw.trim();
    if (!clean || clean.toLowerCase() === "purchased") continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

export function AddItemModal({
  open,
  mode = "single",
  prefill = null,
  onModeChange,
  existingUrls = [],
  availableTags = [],
  defaultCurrency = "$",
  onClose,
  onPreviewUrl,
  onPreviewUrlsBatch,
  onSaveItem,
  onSaveItemsBatch,
  onNotify,
}: AddItemModalProps) {
  const [internalMode, setInternalMode] = useState<AddModalMode>(mode);
  const activeMode = onModeChange ? mode : internalMode;

  // Single URL state
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [initialPrice, setInitialPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [captchaBlockedMsg, setCaptchaBlockedMsg] = useState<string | null>(
    null,
  );
  const [prefillNotice, setPrefillNotice] = useState(false);

  // Bulk URL state
  const [bulkUrlsText, setBulkUrlsText] = useState("");
  const [bulkDiscountPct, setBulkDiscountPct] = useState("15");
  const [bulkTagNames, setBulkTagNames] = useState<string[]>([]);
  const [bulkStep, setBulkStep] = useState<BulkStep>("input");
  const [draftCards, setDraftCards] = useState<BulkDraftCard[]>([]);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [failedOutcomes, setFailedOutcomes] = useState<BulkFailedOutcome[]>([]);
  const [savedSummaries, setSavedSummaries] = useState<BulkSavedSummary[]>([]);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  // Shared loading state
  const [fetching, setFetching] = useState(false);
  const [loadingTitle, setLoadingTitle] = useState("Fetching product metadata...");

  const dialogRef = useRef<HTMLDivElement>(null);
  const swipeHandleRef = useRef<HTMLDivElement>(null);
  const carouselViewportRef = useRef<HTMLDivElement>(null);
  const carouselTrackRef = useRef<HTMLDivElement>(null);
  const activeCardIndexRef = useRef(activeCardIndex);
  activeCardIndexRef.current = activeCardIndex;
  const draftCardsLengthRef = useRef(draftCards.length);
  draftCardsLengthRef.current = draftCards.length;

  useBottomSheetSwipeDismiss({
    sheetRef: dialogRef,
    handleRef: swipeHandleRef,
    isOpen: open,
    disabled: fetching,
    onClose,
  });

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (fetching) return;
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (fetching) return;
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, fetching, onClose]);

  useEffect(() => {
    const viewportEl = carouselViewportRef.current;
    const trackEl = carouselTrackRef.current;
    if (
      !open ||
      activeMode !== "bulk" ||
      bulkStep !== "review" ||
      fetching ||
      !viewportEl ||
      !trackEl
    ) {
      return;
    }

    let modeKind: "touch" | "pointer" | null = null;
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let dragging = false;
    let disposed = false;

    const resetTrack = (animate: boolean) => {
      trackEl.style.transition = animate
        ? "transform 180ms cubic-bezier(0.32, 0.72, 0, 1)"
        : "";
      trackEl.style.transform = "translate3d(0, 0, 0)";
    };

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest("input, textarea, select, button, a, label"),
      );
    };

    const begin = (
      kind: "touch" | "pointer",
      pid: number | null,
      x: number,
      y: number,
      target: EventTarget | null,
    ) => {
      if (disposed || draftCardsLengthRef.current <= 1) return;
      if (isInteractiveTarget(target)) return;
      modeKind = kind;
      pointerId = pid;
      startX = x;
      startY = y;
      lastX = x;
      dragging = false;
    };

    const move = (x: number, y: number, ev?: Event) => {
      if (!modeKind || disposed) return;
      const dx = x - startX;
      const dy = y - startY;
      lastX = x;
      if (!dragging) {
        if (Math.abs(dy) > SWIPE_ACTIVATION_PX && Math.abs(dy) >= Math.abs(dx)) {
          modeKind = null;
          return;
        }
        if (Math.abs(dx) > SWIPE_ACTIVATION_PX && Math.abs(dx) > Math.abs(dy)) {
          dragging = true;
          trackEl.style.transition = "none";
        } else {
          return;
        }
      }
      if (ev?.cancelable) ev.preventDefault();
      const idx = activeCardIndexRef.current;
      const len = draftCardsLengthRef.current;
      const atLeftEdge = idx === 0 && dx > 0;
      const atRightEdge = idx >= len - 1 && dx < 0;
      const dampedDx = atLeftEdge || atRightEdge ? dx * 0.28 : dx;
      trackEl.style.transform = `translate3d(${dampedDx}px, 0, 0)`;
    };

    const end = (cancelled: boolean) => {
      if (!modeKind) return;
      const wasDragging = dragging;
      const dx = lastX - startX;
      modeKind = null;
      pointerId = null;
      dragging = false;
      if (!wasDragging) return;

      const idx = activeCardIndexRef.current;
      const len = draftCardsLengthRef.current;
      if (!cancelled && dx <= -SWIPE_COMMIT_PX && idx < len - 1) {
        setActiveCardIndex((prev) => Math.min(len - 1, prev + 1));
      } else if (!cancelled && dx >= SWIPE_COMMIT_PX && idx > 0) {
        setActiveCardIndex((prev) => Math.max(0, prev - 1));
      }
      resetTrack(true);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        modeKind = null;
        return;
      }
      const touch = e.touches[0];
      if (!touch) return;
      begin("touch", null, touch.clientX, touch.clientY, e.target);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (modeKind !== "touch") return;
      const touch = e.touches[0];
      if (!touch) return;
      move(touch.clientX, touch.clientY, e);
    };

    const onTouchEnd = () => {
      if (modeKind !== "touch") return;
      end(false);
    };

    const onTouchCancel = () => {
      if (modeKind !== "touch") return;
      end(true);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      begin("pointer", e.pointerId, e.clientX, e.clientY, e.target);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (modeKind !== "pointer" || pointerId !== e.pointerId) return;
      move(e.clientX, e.clientY, e);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (modeKind !== "pointer" || pointerId !== e.pointerId) return;
      end(false);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (modeKind !== "pointer" || pointerId !== e.pointerId) return;
      end(true);
    };

    viewportEl.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchCancel, { passive: true });

    viewportEl.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);

    return () => {
      disposed = true;
      resetTrack(false);
      viewportEl.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchCancel);

      viewportEl.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [open, activeMode, bulkStep, fetching]);

  const parsedBulk = useMemo(
    () => parseBulkUrls(bulkUrlsText, existingUrls),
    [bulkUrlsText, existingUrls],
  );

  useEffect(() => {
    if (!open) {
      setCaptchaBlockedMsg(null);
      setPrefillNotice(false);
      return;
    }
    if (!prefill) return;
    if (prefill.url) setUrl(prefill.url);
    if (prefill.title) setTitle(prefill.title);
    if (prefill.image) setImageUrl(prefill.image);
    if (prefill.currency) setCurrency(prefill.currency);
    if (prefill.price) {
      const numeric = Number(prefill.price);
      setInitialPrice(prefill.price);
      if (Number.isFinite(numeric) && numeric > 0) {
        setTargetPrice(String(Math.round(numeric * 0.85 * 100) / 100));
      }
    }
    setCaptchaBlockedMsg(null);
    setPrefillNotice(true);
  }, [open, prefill]);

  if (!open) return null;

  const switchMode = (nextMode: AddModalMode) => {
    if (fetching) return;
    setInternalMode(nextMode);
    onModeChange?.(nextMode);
  };

  const handleAddTag = (tagName: string) => {
    const clean = tagName.trim();
    if (!clean || clean.toLowerCase() === "purchased") return;
    setSelectedTagNames((prev) =>
      prev.some((n) => n.toLowerCase() === clean.toLowerCase())
        ? prev
        : [...prev, clean],
    );
  };

  const handleRemoveTag = (tagName: string) => {
    setSelectedTagNames((prev) =>
      prev.filter((n) => n.toLowerCase() !== tagName.trim().toLowerCase()),
    );
  };

  const handleAddBulkTag = (tagName: string) => {
    const clean = tagName.trim();
    if (!clean || clean.toLowerCase() === "purchased") return;
    setBulkTagNames((prev) =>
      prev.some((n) => n.toLowerCase() === clean.toLowerCase())
        ? prev
        : [...prev, clean],
    );
  };

  const handleRemoveBulkTag = (tagName: string) => {
    setBulkTagNames((prev) =>
      prev.filter((n) => n.toLowerCase() !== tagName.trim().toLowerCase()),
    );
  };

  const notifyRetryAttempt: RequestRetryCallback = (info) => {
    setLoadingTitle(
      `Retrying (Attempt ${info.nextAttempt}/${info.maxAttempts})...`,
    );
    onNotify?.(
      "warning",
      `Bad result. Attempt #${info.nextAttempt}`,
      `${info.reason} — retrying request (${info.nextAttempt}/${info.maxAttempts})...`,
    );
  };

  const handleFetch = async () => {
    if (!url.trim()) {
      onNotify?.(
        "warning",
        "Missing URL",
        "Enter a product URL before fetching a preview.",
      );
      return;
    }
    setCaptchaBlockedMsg(null);
    setLoadingTitle("Fetching product metadata...");
    setFetching(true);
    try {
      const preview = await onPreviewUrl(url.trim(), notifyRetryAttempt);
      setTitle(preview.title);
      setImageUrl(preview.image_url);
      setCurrency(preview.currency);
      setInitialPrice(String(preview.price));
      setTargetPrice(String(Math.round(preview.price * 0.85 * 100) / 100));
      if (preview.suggested_tags.length > 0 && selectedTagNames.length === 0) {
        setSelectedTagNames(
          preview.suggested_tags.filter(
            (t) => t.trim() && t.trim().toLowerCase() !== "purchased",
          ),
        );
      }
      onNotify?.(
        "success",
        "Preview fetched",
        `Extracted ${preview.title} (${preview.currency}${preview.price}).`,
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Could not extract product metadata.";
      if (/CAPTCHA_BLOCKED|HTTP 403/i.test(msg)) {
        setSelectedTagNames((prev) =>
          prev.some((t) => t.toLowerCase() === MANUAL_CHECK_TAG)
            ? prev
            : [...prev, MANUAL_CHECK_TAG],
        );
        setCaptchaBlockedMsg(
          "This retailer uses anti-bot / CAPTCHA protection, so PricePulse cannot fetch it automatically. Enter the Product Title and Baseline Price manually below and save — PricePulse will include this item in your once-daily manual-check email with direct links to check and update it.",
        );
        onNotify?.(
          "warning",
          "Anti-bot protection detected",
          "Enter Product Title and Baseline Price manually below. Daily manual-check reminders will include direct update links.",
        );
      } else {
        onNotify?.("error", "Preview failed", msg);
      }
    } finally {
      setFetching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fetching) return;
    const init = Number(initialPrice);
    const target = Number(targetPrice);
    if (!title.trim() || !url.trim() || !(init > 0) || !(target > 0)) {
      onNotify?.(
        "warning",
        "Incomplete item details",
        "Provide a product URL, title, and positive baseline/target prices.",
      );
      return;
    }
    setLoadingTitle("Saving tracked item...");
    setFetching(true);
    try {
      await onSaveItem({
        name: title.trim(),
        url: url.trim(),
        image_url: imageUrl.trim(),
        currency: currency.trim() || defaultCurrency,
        initial_price: init,
        target_price: target,
        tag_names: selectedTagNames,
      });
      const savedNorm = normalizeUrlForCompare(url);
      setFailedOutcomes((prev) => {
        const remaining = prev.filter(
          (f) => normalizeUrlForCompare(f.url) !== savedNorm,
        );
        if (remaining.length !== prev.length) {
          setBulkUrlsText(remaining.map((f) => f.url).join("\n"));
          if (remaining.length === 0) {
            setBulkStep("input");
            setDraftCards([]);
            setSavedSummaries([]);
          }
        }
        return remaining;
      });
      setUrl("");
      setTitle("");
      setImageUrl("");
      setInitialPrice("");
      setTargetPrice("");
      setSelectedTagNames([]);
      onClose();
    } catch (err) {
      onNotify?.(
        "error",
        "Failed to add item",
        err instanceof Error ? err.message : "Could not save tracked item.",
      );
    } finally {
      setFetching(false);
    }
  };

  const handleFetchBulkPreviews = async () => {
    if (parsedBulk.validUrls.length === 0) {
      onNotify?.(
        "warning",
        "No valid new URLs",
        "Paste at least one valid HTTP/HTTPS product URL that is not already tracked.",
      );
      return;
    }
    const rawDiscount = Number(bulkDiscountPct);
    const discountPct =
      Number.isFinite(rawDiscount) && rawDiscount >= 1 && rawDiscount <= 90
        ? rawDiscount
        : 15;

    setLoadingTitle(
      `Scraping ${parsedBulk.validUrls.length} product URL(s)...`,
    );
    setFetching(true);
    try {
      let results: BatchPreviewItemResult[];
      if (onPreviewUrlsBatch) {
        results = await onPreviewUrlsBatch(
          parsedBulk.validUrls,
          notifyRetryAttempt,
        );
      } else {
        results = await Promise.all(
          parsedBulk.validUrls.map(async (itemUrl) => {
            try {
              const preview = await onPreviewUrl(itemUrl);
              return { url: itemUrl, success: true, preview, error: null };
            } catch (err) {
              return {
                url: itemUrl,
                success: false,
                preview: null,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }),
        );
      }

      const nextCards: BulkDraftCard[] = [];
      const nextFailures: BulkFailedOutcome[] = [];
      results.forEach((res, idx) => {
        if (res.success && res.preview) {
          const computedTarget =
            Math.round(res.preview.price * (1 - discountPct / 100) * 100) / 100;
          nextCards.push({
            id: `draft-${idx}-${Date.now()}`,
            url: res.preview.url || res.url,
            title: res.preview.title,
            imageUrl: res.preview.image_url,
            currency: res.preview.currency || defaultCurrency,
            initialPrice: String(res.preview.price),
            targetPrice: String(
              computedTarget > 0 ? computedTarget : res.preview.price,
            ),
            tagNames: mergeUniqueTags(bulkTagNames, res.preview.suggested_tags),
            included: true,
            extractionTier: res.preview.extraction_tier,
          });
        } else {
          nextFailures.push({
            url: res.url,
            error: res.error || "Unable to extract product price or metadata.",
          });
        }
      });

      setDraftCards(nextCards);
      setFailedOutcomes(nextFailures);
      setSavedSummaries([]);
      setFailedImages({});
      setActiveCardIndex(0);

      if (nextCards.length > 0) {
        setBulkStep("review");
        onNotify?.(
          nextFailures.length > 0 ? "warning" : "success",
          "Bulk preview ready",
          nextFailures.length > 0
            ? `Fetched ${nextCards.length} item(s); ${nextFailures.length} URL(s) failed.`
            : `Fetched ${nextCards.length} product preview(s) for validation.`,
        );
      } else {
        setBulkUrlsText(nextFailures.map((f) => f.url).join("\n"));
        setBulkStep("summary");
        onNotify?.(
          "warning",
          "No previews extracted",
          `All ${nextFailures.length} URL(s) failed extraction. Review errors or configure manually.`,
        );
      }
    } catch (err) {
      onNotify?.(
        "error",
        "Bulk preview failed",
        err instanceof Error
          ? err.message
          : "Could not fetch bulk product previews.",
      );
    } finally {
      setFetching(false);
    }
  };

  const currentCard = draftCards[activeCardIndex] ?? null;

  const updateCurrentCard = (updater: (card: BulkDraftCard) => BulkDraftCard) => {
    if (!currentCard) return;
    setDraftCards((prev) =>
      prev.map((card, idx) => (idx === activeCardIndex ? updater(card) : card)),
    );
  };

  const includedCards = draftCards.filter((c) => c.included);

  const handleSaveValidatedBatch = async () => {
    if (fetching || includedCards.length === 0) return;

    const payloads: AddItemPayload[] = [];
    for (let i = 0; i < draftCards.length; i += 1) {
      const card = draftCards[i];
      if (!card.included) continue;
      const init = Number(card.initialPrice);
      const target = Number(card.targetPrice);
      if (!card.title.trim() || !(init > 0) || !(target > 0)) {
        setActiveCardIndex(i);
        onNotify?.(
          "warning",
          "Incomplete validated card",
          `Card (${i + 1}/${draftCards.length}) requires a title and positive prices.`,
        );
        return;
      }
      payloads.push({
        name: card.title.trim(),
        url: card.url.trim(),
        image_url: card.imageUrl.trim(),
        currency: card.currency.trim() || defaultCurrency,
        initial_price: init,
        target_price: target,
        tag_names: card.tagNames,
      });
    }

    setLoadingTitle(`Saving ${payloads.length} validated item(s)...`);
    setFetching(true);
    try {
      if (onSaveItemsBatch) {
        await onSaveItemsBatch(payloads);
      } else {
        for (const payload of payloads) {
          await onSaveItem(payload);
        }
      }

      const summaries: BulkSavedSummary[] = payloads.map((p) => ({
        url: p.url,
        name: p.name,
        currency: p.currency,
        price: p.initial_price,
        targetPrice: p.target_price,
      }));

      if (failedOutcomes.length === 0) {
        setBulkUrlsText("");
        setDraftCards([]);
        setFailedOutcomes([]);
        setSavedSummaries([]);
        setBulkStep("input");
        onClose();
        return;
      }

      setSavedSummaries(summaries);
      setBulkUrlsText(failedOutcomes.map((f) => f.url).join("\n"));
      setBulkStep("summary");
      onNotify?.(
        "warning",
        "Partial bulk import",
        `Saved ${summaries.length} item(s); ${failedOutcomes.length} failed URL(s) remain for recovery.`,
      );
    } catch (err) {
      onNotify?.(
        "error",
        "Batch save failed",
        err instanceof Error ? err.message : "Could not save validated items.",
      );
    } finally {
      setFetching(false);
    }
  };

  const handleConfigureManually = (failedUrl: string, failedError = "") => {
    setUrl(failedUrl);
    setTitle("");
    setImageUrl("");
    setCurrency(defaultCurrency);
    setInitialPrice("");
    setTargetPrice("");
    const needsManualCheck = /CAPTCHA_BLOCKED|HTTP 403/i.test(failedError);
    setSelectedTagNames(
      needsManualCheck &&
        !bulkTagNames.some((t) => t.toLowerCase() === MANUAL_CHECK_TAG)
        ? [...bulkTagNames, MANUAL_CHECK_TAG]
        : [...bulkTagNames],
    );
    switchMode("single");
  };

  const handleResetAndClose = () => {
    setBulkUrlsText("");
    setDraftCards([]);
    setFailedOutcomes([]);
    setSavedSummaries([]);
    setBulkStep("input");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
      <div
        id={ANCHORS.modalAddItem}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={fetching}
        aria-labelledby="add-item-modal-title"
        className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[20px] border border-gray-200 bg-white p-4 text-zinc-950 shadow-xl sm:rounded-2xl sm:p-6"
      >
        {fetching && (
          <div
            id={ANCHORS.modalAddItemLoadingOverlay}
            aria-live="polite"
            className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center gap-2.5 rounded-t-[20px] bg-white/80 p-6 text-center backdrop-blur-[2px] sm:rounded-2xl"
          >
            <div
              aria-hidden="true"
              className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-950"
            />
            <div className="text-xs font-semibold text-zinc-950">
              {loadingTitle}
            </div>
            <div className="text-[11px] text-zinc-500">
              Waiting for server response
            </div>
          </div>
        )}

        <div
          ref={swipeHandleRef}
          data-swipe-handle="true"
          className="touch-none sm:touch-auto"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1 w-9 rounded-full bg-zinc-300 sm:hidden"
          />

          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="add-item-modal-title"
                className="text-base font-semibold text-zinc-950"
              >
                Track New Product URL
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                {activeMode === "single"
                  ? "Paste a retailer link to extract current price and metadata"
                  : "Paste up to 20 retailer links for pooled extraction and visual review"}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close Add Item modal"
              disabled={fetching}
              onClick={onClose}
              className="min-h-11 min-w-11 shrink-0 rounded-lg px-2 py-1 text-lg text-zinc-500 hover:bg-gray-100 hover:text-zinc-950 disabled:opacity-40 sm:min-h-9 sm:min-w-9"
            >
              &times;
            </button>
          </div>
        </div>

        <div
          id={ANCHORS.modalAddItemModeTabs}
          role="tablist"
          aria-label="URL entry mode"
          className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === "single"}
            disabled={fetching}
            onClick={() => switchMode("single")}
            className={`min-h-9 rounded-lg px-3 py-1.5 font-medium transition-colors ${
              activeMode === "single"
                ? "bg-white font-semibold text-zinc-950 shadow-xs"
                : "text-zinc-500 hover:text-zinc-950"
            }`}
          >
            Single URL
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === "bulk"}
            disabled={fetching}
            onClick={() => switchMode("bulk")}
            className={`min-h-9 rounded-lg px-3 py-1.5 font-medium transition-colors ${
              activeMode === "bulk"
                ? "bg-white font-semibold text-zinc-950 shadow-xs"
                : "text-zinc-500 hover:text-zinc-950"
            }`}
          >
            Bulk URL List
          </button>
        </div>

        {activeMode === "single" ? (
          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            <fieldset
              disabled={fetching}
              className="m-0 min-w-0 space-y-3.5 border-0 p-0"
            >
              <div>
                <label
                  htmlFor="add-item-url"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                >
                  Product URL
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="add-item-url"
                    type="url"
                    required
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://retailer.com/product/..."
                    className="min-h-11 min-w-0 flex-1 rounded-lg bg-gray-100 px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-10"
                  />
                  <button
                    type="button"
                    onClick={() => void handleFetch()}
                    disabled={fetching}
                    aria-busy={fetching}
                    className="min-h-11 shrink-0 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-950 hover:bg-gray-50 disabled:opacity-40 sm:min-h-10"
                  >
                    {fetching ? "Fetching..." : "Fetch Preview"}
                  </button>
                </div>
                {prefillNotice && (
                  <div
                    role="status"
                    className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-[11px] text-blue-900"
                  >
                    Loaded product details from your browser session. Review the
                    title and price below, then click{" "}
                    <span className="font-semibold">Save &amp; Start Tracking</span>.
                  </div>
                )}
                {captchaBlockedMsg && (
                  <div
                    role="status"
                    className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-950"
                  >
                    <p className="font-semibold">
                      Anti-Bot / CAPTCHA Protection Detected
                    </p>
                    <p className="leading-relaxed text-amber-900">
                      {captchaBlockedMsg}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="add-item-title"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                >
                  Product Title
                </label>
                <input
                  id="add-item-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Auto-filled on preview or type manually..."
                  className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-10"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div className="min-w-0">
                  <label
                    htmlFor="add-item-currency"
                    className="mb-1.5 block truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Currency
                  </label>
                  <input
                    id="add-item-currency"
                    type="text"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-10"
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="add-item-baseline"
                    className="mb-1.5 block truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Baseline Price
                  </label>
                  <input
                    id="add-item-baseline"
                    type="number"
                    step="0.01"
                    required
                    value={initialPrice}
                    onChange={(e) => setInitialPrice(e.target.value)}
                    placeholder="0.00"
                    className="tabular-nums min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-10"
                  />
                </div>
                <div className="min-w-0">
                  <label
                    htmlFor="add-item-target"
                    className="mb-1.5 block truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Target Alert Price
                  </label>
                  <input
                    id="add-item-target"
                    type="number"
                    step="0.01"
                    required
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    placeholder="0.00"
                    className="tabular-nums min-h-11 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Tags
                </span>
                <TagAdderControl
                  idPrefix="add-item-tag"
                  availableTags={availableTags}
                  selectedTagNames={selectedTagNames}
                  onAddTag={handleAddTag}
                  onRemoveTag={handleRemoveTag}
                  readOnly={fetching}
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-gray-200 sm:min-h-10"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-11 rounded-lg bg-zinc-950 px-5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 sm:min-h-10"
                >
                  Save &amp; Start Tracking
                </button>
              </div>
            </fieldset>
          </form>
        ) : bulkStep === "input" ? (
          <div className="space-y-3.5 text-xs">
            <fieldset
              disabled={fetching}
              className="m-0 min-w-0 space-y-3.5 border-0 p-0"
            >
              <div>
                <label
                  htmlFor="bulk-url-input"
                  className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                >
                  Product URLs (up to 20)
                </label>
                <textarea
                  id="bulk-url-input"
                  rows={5}
                  value={bulkUrlsText}
                  onChange={(e) => setBulkUrlsText(e.target.value)}
                  placeholder={
                    "https://retailer.com/product-1\nhttps://retailer.com/product-2"
                  }
                  className="min-h-[112px] w-full min-w-0 rounded-lg bg-gray-100 px-3 py-2.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                />
                <div
                  role="status"
                  aria-live="polite"
                  className="tabular-nums mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-zinc-600"
                >
                  <span className="font-semibold text-zinc-950">
                    {parsedBulk.validUrls.length} valid URL
                    {parsedBulk.validUrls.length === 1 ? "" : "s"}
                  </span>
                  {parsedBulk.alreadyTracked.length > 0 && (
                    <span>
                      &bull; {parsedBulk.alreadyTracked.length} already tracked
                      (skipped)
                    </span>
                  )}
                  {parsedBulk.duplicates.length > 0 && (
                    <span>
                      &bull; {parsedBulk.duplicates.length} duplicate
                      {parsedBulk.duplicates.length === 1 ? "" : "s"}
                    </span>
                  )}
                  {parsedBulk.invalid.length > 0 && (
                    <span className="text-red-600">
                      &bull; {parsedBulk.invalid.length} invalid
                    </span>
                  )}
                  {parsedBulk.overflowCount > 0 && (
                    <span className="text-amber-700">
                      &bull; {parsedBulk.overflowCount} over 20-URL batch cap
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
                <div className="min-w-0">
                  <label
                    htmlFor="bulk-target-discount"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Target Discount %
                  </label>
                  <input
                    id="bulk-target-discount"
                    type="number"
                    min={1}
                    max={90}
                    value={bulkDiscountPct}
                    onChange={(e) => setBulkDiscountPct(e.target.value)}
                    className="tabular-nums min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-10"
                  />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Shared Tags
                  </span>
                  <TagAdderControl
                    idPrefix="bulk-item-tag"
                    availableTags={availableTags}
                    selectedTagNames={bulkTagNames}
                    onAddTag={handleAddBulkTag}
                    onRemoveTag={handleRemoveBulkTag}
                    readOnly={fetching}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-gray-200 sm:min-h-10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={parsedBulk.validUrls.length === 0}
                  onClick={() => void handleFetchBulkPreviews()}
                  className="tabular-nums min-h-11 rounded-lg bg-zinc-950 px-5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-40 sm:min-h-10"
                >
                  Fetch Previews ({parsedBulk.validUrls.length} URL
                  {parsedBulk.validUrls.length === 1 ? "" : "s"})
                </button>
              </div>
            </fieldset>
          </div>
        ) : bulkStep === "review" && currentCard ? (
          <div
            id={ANCHORS.modalAddItemReviewCarousel}
            className="min-w-0 space-y-3.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-zinc-950">
                    Visual Validation
                  </span>
                  <span className="tabular-nums rounded-full bg-zinc-950 px-2 py-0.5 text-[11px] font-semibold text-white">
                    ({activeCardIndex + 1}/{draftCards.length})
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  Swipe card horizontally or use arrows to verify each item
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Previous fetched item"
                  disabled={activeCardIndex === 0 || fetching}
                  onClick={() =>
                    setActiveCardIndex((prev) => Math.max(0, prev - 1))
                  }
                  className="min-h-9 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-950 hover:bg-gray-100 disabled:opacity-40"
                >
                  &larr; Prev
                </button>
                <button
                  type="button"
                  aria-label="Next fetched item"
                  disabled={activeCardIndex >= draftCards.length - 1 || fetching}
                  onClick={() =>
                    setActiveCardIndex((prev) =>
                      Math.min(draftCards.length - 1, prev + 1),
                    )
                  }
                  className="min-h-9 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-950 hover:bg-gray-100 disabled:opacity-40"
                >
                  Next &rarr;
                </button>
              </div>
            </div>

            <div className="h-1 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-200"
                style={{
                  width: `${((activeCardIndex + 1) / draftCards.length) * 100}%`,
                }}
              />
            </div>

            <div
              ref={carouselViewportRef}
              role="region"
              aria-label="Fetched item preview card"
              className="touch-pan-y min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white"
            >
              <div
                ref={carouselTrackRef}
                className="min-w-0 space-y-3 p-3.5 will-change-transform"
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {currentCard.imageUrl && !failedImages[currentCard.id] ? (
                      <img
                        src={currentCard.imageUrl}
                        alt=""
                        onError={() =>
                          setFailedImages((prev) => ({
                            ...prev,
                            [currentCard.id]: true,
                          }))
                        }
                        className="h-12 w-12 shrink-0 rounded-lg border border-gray-200 bg-gray-50 object-cover"
                      />
                    ) : (
                      <div
                        aria-hidden="true"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-[10px] font-semibold text-zinc-500"
                      >
                        IMG
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-zinc-500">
                        {currentCard.url}
                      </div>
                      <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                        {currentCard.extractionTier.replaceAll("_", " ")}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-pressed={currentCard.included}
                    onClick={() =>
                      updateCurrentCard((card) => ({
                        ...card,
                        included: !card.included,
                      }))
                    }
                    className={`min-h-8 shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      currentCard.included
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        : "border-gray-200 bg-gray-100 text-zinc-500 hover:bg-gray-200"
                    }`}
                  >
                    {currentCard.included ? "Included" : "Skipped"}
                  </button>
                </div>

                <div>
                  <label
                    htmlFor="bulk-card-title"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                  >
                    Product Title
                  </label>
                  <input
                    id="bulk-card-title"
                    type="text"
                    value={currentCard.title}
                    onChange={(e) =>
                      updateCurrentCard((card) => ({
                        ...card,
                        title: e.target.value,
                      }))
                    }
                    className="min-h-10 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div className="min-w-0">
                    <label
                      htmlFor="bulk-card-currency"
                      className="mb-1.5 block truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Currency
                    </label>
                    <input
                      id="bulk-card-currency"
                      type="text"
                      value={currentCard.currency}
                      onChange={(e) =>
                        updateCurrentCard((card) => ({
                          ...card,
                          currency: e.target.value,
                        }))
                      }
                      className="min-h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor="bulk-card-baseline"
                      className="mb-1.5 block truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Baseline Price
                    </label>
                    <input
                      id="bulk-card-baseline"
                      type="number"
                      step="0.01"
                      value={currentCard.initialPrice}
                      onChange={(e) =>
                        updateCurrentCard((card) => ({
                          ...card,
                          initialPrice: e.target.value,
                        }))
                      }
                      className="tabular-nums min-h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor="bulk-card-target"
                      className="mb-1.5 block truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Target Alert Price
                    </label>
                    <input
                      id="bulk-card-target"
                      type="number"
                      step="0.01"
                      value={currentCard.targetPrice}
                      onChange={(e) =>
                        updateCurrentCard((card) => ({
                          ...card,
                          targetPrice: e.target.value,
                        }))
                      }
                      className="tabular-nums min-h-10 w-full min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Item Tags
                  </span>
                  <TagAdderControl
                    key={currentCard.id}
                    idPrefix={`bulk-card-tag-${currentCard.id}`}
                    availableTags={availableTags}
                    selectedTagNames={currentCard.tagNames}
                    onAddTag={(tagName) =>
                      updateCurrentCard((card) => ({
                        ...card,
                        tagNames: mergeUniqueTags(card.tagNames, [tagName]),
                      }))
                    }
                    onRemoveTag={(tagName) =>
                      updateCurrentCard((card) => ({
                        ...card,
                        tagNames: card.tagNames.filter(
                          (t) =>
                            t.trim().toLowerCase() !==
                            tagName.trim().toLowerCase(),
                        ),
                      }))
                    }
                    readOnly={fetching}
                  />
                </div>
              </div>
            </div>

            {failedOutcomes.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                <span className="tabular-nums font-semibold">
                  {failedOutcomes.length} URL
                  {failedOutcomes.length === 1 ? "" : "s"} failed preview
                </span>{" "}
                and will remain in the recovery window after saving.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
              <button
                type="button"
                disabled={fetching}
                onClick={() => setBulkStep("input")}
                className="min-h-11 rounded-lg bg-gray-100 px-3.5 py-2 text-xs font-medium text-zinc-950 hover:bg-gray-200 sm:min-h-10"
              >
                &larr; Edit URL List
              </button>
              <button
                type="button"
                disabled={fetching || includedCards.length === 0}
                onClick={() => void handleSaveValidatedBatch()}
                className="tabular-nums min-h-11 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-40 sm:min-h-10"
              >
                Save Validated Items ({includedCards.length})
              </button>
            </div>
          </div>
        ) : (
          <div
            id={ANCHORS.modalAddItemBulkSummary}
            className="min-w-0 space-y-3.5 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
              <div className="tabular-nums font-semibold text-zinc-950">
                {savedSummaries.length > 0
                  ? `${savedSummaries.length} Succeeded & Saved`
                  : "0 Items Saved"}
              </div>
              <div className="tabular-nums font-semibold text-red-600">
                {failedOutcomes.length} Failed
              </div>
            </div>

            <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {savedSummaries.map((item) => (
                <div
                  key={`saved-${item.url}`}
                  className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-zinc-950">
                      {item.name}
                    </span>
                    <span className="tabular-nums shrink-0 text-[11px] font-medium text-emerald-800">
                      Saved ({item.currency}
                      {item.price.toFixed(2)})
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {item.url}
                  </div>
                </div>
              ))}

              {failedOutcomes.map((failed) => (
                <div
                  key={`failed-${failed.url}`}
                  className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2.5"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="break-all text-[11px] font-semibold text-zinc-950">
                        {failed.url}
                      </div>
                      <div className="mt-0.5 break-words text-[11px] text-red-700">
                        {failed.error}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Configure manually ${failed.url}`}
                      onClick={() => handleConfigureManually(failed.url, failed.error)}
                      className="min-h-9 shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-gray-50"
                    >
                      Configure Manually &rarr;
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label
                htmlFor="bulk-url-input"
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                Remaining Failed URLs
              </label>
              <textarea
                id="bulk-url-input"
                rows={3}
                value={bulkUrlsText}
                onChange={(e) => setBulkUrlsText(e.target.value)}
                className="w-full min-w-0 rounded-lg bg-gray-100 px-3 py-2 text-xs text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={handleResetAndClose}
                className="min-h-11 rounded-lg bg-gray-100 px-4 py-2 text-xs font-medium text-zinc-950 hover:bg-gray-200 sm:min-h-10"
              >
                Done
              </button>
              <button
                type="button"
                disabled={fetching || parsedBulk.validUrls.length === 0}
                onClick={() => void handleFetchBulkPreviews()}
                className="tabular-nums min-h-11 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-40 sm:min-h-10"
              >
                Retry Failed URLs ({parsedBulk.validUrls.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
