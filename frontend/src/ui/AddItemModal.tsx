import { useState } from "react";
import type { AddItemPayload, ScrapePreview, Tag } from "../domain/models";
import {
  TAG_ACTIVE_BADGE_CLASSES,
  TAG_BADGE_CLASSES,
  TAG_DOT_CLASSES,
} from "../domain/models";
import { ANCHORS } from "../shared/anchors";

interface AddItemModalProps {
  open: boolean;
  availableTags?: Tag[];
  defaultCurrency?: string;
  onClose: () => void;
  onPreviewUrl: (url: string) => Promise<ScrapePreview>;
  onSaveItem: (payload: AddItemPayload) => Promise<void>;
}

export function AddItemModal({
  open,
  availableTags = [],
  defaultCurrency = "$",
  onClose,
  onPreviewUrl,
  onSaveItem,
}: AddItemModalProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [initialPrice, setInitialPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [fetching, setFetching] = useState(false);

  if (!open) return null;

  const selectedTagNames = tagsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const toggleSuggestedTag = (tagName: string) => {
    const exists = selectedTagNames.some(
      (n) => n.toLowerCase() === tagName.toLowerCase(),
    );
    const next = exists
      ? selectedTagNames.filter((n) => n.toLowerCase() !== tagName.toLowerCase())
      : [...selectedTagNames, tagName];
    setTagsText(next.join(", "));
  };

  const handleFetch = async () => {
    if (!url.trim()) return;
    setFetching(true);
    try {
      const preview = await onPreviewUrl(url.trim());
      setTitle(preview.title);
      setImageUrl(preview.image_url);
      setCurrency(preview.currency);
      setInitialPrice(String(preview.price));
      setTargetPrice(String(Math.round(preview.price * 0.85 * 100) / 100));
      if (preview.suggested_tags.length > 0 && !tagsText) {
        setTagsText(preview.suggested_tags.join(", "));
      }
    } finally {
      setFetching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const init = Number(initialPrice);
    const target = Number(targetPrice);
    if (!title.trim() || !url.trim() || !(init > 0) || !(target > 0)) return;
    const tagNames = tagsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    await onSaveItem({
      name: title.trim(),
      url: url.trim(),
      image_url: imageUrl.trim(),
      currency: currency.trim() || defaultCurrency,
      initial_price: init,
      target_price: target,
      tag_names: tagNames,
    });
    setUrl("");
    setTitle("");
    setInitialPrice("");
    setTargetPrice("");
    setTagsText("");
    onClose();
  };

  return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/30 p-0 backdrop-blur-[2px] sm:items-center sm:p-4">
        <div
          id={ANCHORS.modalAddItem}
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-item-modal-title"
          className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[20px] border border-gray-200 bg-white p-4 text-zinc-950 shadow-xl sm:rounded-2xl sm:p-6"
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
                onClick={onClose}
                className="min-h-11 min-w-11 shrink-0 rounded-lg px-2 py-1 text-lg text-zinc-500 hover:bg-gray-100 hover:text-zinc-950 sm:min-h-9 sm:min-w-9"
              >
                &times;
              </button>
            </div>

              <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
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
                                  <label
                                    htmlFor="add-item-tags"
                                    className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                                  >
                                    Tags (comma-separated)
                                  </label>
                                  {availableTags.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {availableTags.map((tag) => {
                                        const isSelected = selectedTagNames.some(
                                          (n) => n.toLowerCase() === tag.name.toLowerCase(),
                                        );
                                        return (
                                          <button
                                            key={tag.tag_id}
                                            type="button"
                                            aria-pressed={isSelected}
                                            onClick={() => toggleSuggestedTag(tag.name)}
                                            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                                              isSelected
                                                ? TAG_ACTIVE_BADGE_CLASSES[tag.color]
                                                : `${TAG_BADGE_CLASSES[tag.color]} hover:opacity-85`
                                            }`}
                                          >
                                            <span
                                              aria-hidden="true"
                                              className={`h-1.5 w-1.5 rounded-full ${
                                                isSelected
                                                  ? "bg-white"
                                                  : TAG_DOT_CLASSES[tag.color]
                                              }`}
                                            />
                                            {tag.name}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  <input
                                    id="add-item-tags"
                                    type="text"
                                    value={tagsText}
                                    onChange={(e) => setTagsText(e.target.value)}
                                    placeholder="Audio, Black Friday"
                                    className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-10"
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
                                </form>
                            </div>
                        </div>
                        );
}
