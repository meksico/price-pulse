import { useEffect, useRef, useState } from "react";
import type { Tag } from "../domain/models";
import { TAG_BADGE_CLASSES, TAG_DOT_CLASSES } from "../domain/models";

const NEW_TAG_OPTION_VALUE = "__NEW__";

interface TagAdderControlProps {
  idPrefix: string;
  availableTags: Tag[];
  selectedTagNames: string[];
  onAddTag: (tagName: string) => void | Promise<void>;
  onRemoveTag?: (tagName: string) => void | Promise<void>;
  readOnly?: boolean;
}

export function TagAdderControl({
  idPrefix,
  availableTags,
  selectedTagNames,
  onAddTag,
  onRemoveTag,
  readOnly = false,
}: TagAdderControlProps) {
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCustomMode) {
      customInputRef.current?.focus();
    }
  }, [isCustomMode]);

  const tagByLowerName = new Map(
    availableTags.map((t) => [t.name.trim().toLowerCase(), t]),
  );

  const unassignedTags = availableTags.filter((tag) => {
    const lower = tag.name.trim().toLowerCase();
    if (lower === "purchased") return false;
    return !selectedTagNames.some((s) => s.trim().toLowerCase() === lower);
  });

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) return;
    if (val === NEW_TAG_OPTION_VALUE) {
      setCustomValue("");
      setIsCustomMode(true);
      return;
    }
    void onAddTag(val);
  };

  const handleCustomSubmit = async () => {
    const clean = customValue.trim();
    if (!clean) return;
    await onAddTag(clean);
    setCustomValue("");
    setIsCustomMode(false);
  };

  const selectId = `${idPrefix}-select`;
  const inputId = `${idPrefix}-custom-input`;

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {selectedTagNames.length === 0 && (
          <span className="text-xs text-zinc-400">No tags assigned</span>
        )}
        {selectedTagNames.map((name) => {
          const matched = tagByLowerName.get(name.trim().toLowerCase());
          const color = matched?.color ?? "slate";
          return (
            <span
              key={name}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TAG_BADGE_CLASSES[color]}`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${TAG_DOT_CLASSES[color]}`}
              />
              {matched?.name ?? name}
              {!readOnly && onRemoveTag && (
                <button
                  type="button"
                  aria-label={`Remove tag ${matched?.name ?? name}`}
                  onClick={() => void onRemoveTag(name)}
                  className="ml-0.5 opacity-60 hover:opacity-100"
                >
                  &times;
                </button>
              )}
            </span>
          );
        })}
      </div>

      {!readOnly && (
        <div>
          {!isCustomMode ? (
            <div className="flex items-center">
              <label htmlFor={selectId} className="sr-only">
                Add Tag
              </label>
              <select
                id={selectId}
                value=""
                onChange={handleSelectChange}
                className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-9 sm:w-auto sm:min-w-[200px]"
              >
                <option value="">+ Add tag...</option>
                {unassignedTags.map((tag) => (
                  <option key={tag.tag_id} value={tag.name}>
                    {tag.name}
                  </option>
                ))}
                <option value={NEW_TAG_OPTION_VALUE}>+ Add new one</option>
              </select>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={inputId} className="sr-only">
                New tag name
              </label>
              <input
                ref={customInputRef}
                id={inputId}
                type="text"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCustomSubmit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setCustomValue("");
                    setIsCustomMode(false);
                  }
                }}
                placeholder="Enter new tag name..."
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-9"
              />
              <button
                type="button"
                onClick={() => void handleCustomSubmit()}
                className="min-h-11 shrink-0 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 sm:min-h-9"
              >
                + Add Tag
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomValue("");
                  setIsCustomMode(false);
                }}
                className="min-h-11 shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-gray-50 sm:min-h-9"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
