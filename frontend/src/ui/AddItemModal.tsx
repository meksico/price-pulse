import { useState } from "react";
import type { AddItemPayload, ScrapePreview } from "../domain/models";
import { ANCHORS } from "../shared/anchors";

interface AddItemModalProps {
  open: boolean;
  onClose: () => void;
  onPreviewUrl: (url: string) => Promise<ScrapePreview>;
  onSaveItem: (payload: AddItemPayload) => Promise<void>;
}

export function AddItemModal({
  open,
  onClose,
  onPreviewUrl,
  onSaveItem,
}: AddItemModalProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [currency, setCurrency] = useState("$");
  const [initialPrice, setInitialPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [fetching, setFetching] = useState(false);

  if (!open) return null;

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
      currency: currency.trim() || "$",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-4">
      <div
        id={ANCHORS.modalAddItem}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-modal-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-2xl sm:p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="add-item-modal-title" className="text-base font-semibold text-slate-100">
            Track New Product URL
          </h2>
          <button
            type="button"
            aria-label="Close Add Item modal"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100 sm:min-h-9 sm:min-w-9"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label htmlFor="add-item-url" className="mb-1 block text-slate-300">
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
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
              />
              <button
                type="button"
                onClick={() => void handleFetch()}
                disabled={fetching}
                aria-busy={fetching}
                className="min-h-11 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 font-medium text-emerald-300 hover:bg-emerald-500/20 sm:min-h-9"
              >
                {fetching ? "Fetching..." : "Fetch Preview"}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="add-item-title" className="mb-1 block text-slate-300">
              Product Title
            </label>
            <input
              id="add-item-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor="add-item-currency" className="mb-1 block text-slate-300">
                Currency
              </label>
              <input
                id="add-item-currency"
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
              />
            </div>
            <div>
              <label htmlFor="add-item-baseline" className="mb-1 block text-slate-300">
                Baseline Price
              </label>
              <input
                id="add-item-baseline"
                type="number"
                step="0.01"
                required
                value={initialPrice}
                onChange={(e) => setInitialPrice(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
              />
            </div>
            <div>
              <label htmlFor="add-item-target" className="mb-1 block text-slate-300">
                Target Alert Price
              </label>
              <input
                id="add-item-target"
                type="number"
                step="0.01"
                required
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
              />
            </div>
          </div>

          <div>
            <label htmlFor="add-item-tags" className="mb-1 block text-slate-300">
              Tags (comma-separated)
            </label>
            <input
              id="add-item-tags"
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="Audio, Black Friday"
              className="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 sm:min-h-9"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg border border-slate-700 px-3 py-2 text-slate-300 hover:bg-slate-800 sm:min-h-9"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="min-h-11 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 hover:bg-emerald-400 sm:min-h-9"
            >
              Save &amp; Start Tracking
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

