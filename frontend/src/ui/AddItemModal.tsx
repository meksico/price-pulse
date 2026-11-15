import { useEffect, useRef, useState } from "react";
import type { AddItemPayload, ScrapePreview, Tag } from "../domain/models";
import { ANCHORS } from "../shared/anchors";
import { useBottomSheetSwipeDismiss } from "../shared/useBottomSheetSwipeDismiss";
import { TagAdderControl } from "./TagAdderControl";
import type { PushToastFn } from "./ToastViewport";

interface AddItemModalProps {
  open: boolean;
  availableTags?: Tag[];
  defaultCurrency?: string;
  onClose: () => void;
  onPreviewUrl: (url: string) => Promise<ScrapePreview>;
  onSaveItem: (payload: AddItemPayload) => Promise<void>;
  onNotify?: PushToastFn;
}

export function AddItemModal({
  open,
  availableTags = [],
  defaultCurrency = "$",
  onClose,
  onPreviewUrl,
  onSaveItem,
  onNotify,
}: AddItemModalProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [initialPrice, setInitialPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const swipeHandleRef = useRef<HTMLDivElement>(null);

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

  if (!open) return null;

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

  const handleFetch = async () => {
    if (!url.trim()) {
      onNotify?.(
        "warning",
        "Missing URL",
        "Enter a product URL before fetching a preview.",
      );
      return;
    }
    setFetching(true);
    try {
      const preview = await onPreviewUrl(url.trim());
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
      onNotify?.(
        "error",
        "Preview failed",
        err instanceof Error
          ? err.message
          : "Could not extract product metadata.",
      );
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
      setUrl("");
      setTitle("");
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
    }
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
                  Fetching product metadata...
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

              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2
                    id="add-item-modal-title"
                    className="text-base font-semibold text-zinc-950"
                  >
                    Track New Product URL
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Paste a retailer link to extract current price and metadata
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
                            </div>
                        </div>
                        );
}
