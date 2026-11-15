import { useMemo, useState } from "react";
import type { BoughtItem, Tag, TagColor, TrackedItem } from "../domain/models";
import {
  TAG_BADGE_CLASSES,
  TAG_COLOR_OPTIONS,
  TAG_DOT_CLASSES,
  formatSavingsByCurrency,
} from "../domain/models";
import { ANCHORS } from "../shared/anchors";

interface TagManagerViewProps {
  tags: Tag[];
  items: TrackedItem[];
  boughtItems: BoughtItem[];
  workspaceCurrency?: string;
  onCreateTag: (name: string, color: TagColor) => Promise<void>;
  onUpdateTag: (
    tagId: string,
    updates: { name?: string; color?: TagColor },
  ) => Promise<void>;
  onDeleteTag: (tagId: string) => Promise<void>;
  onViewInGrid: (tagId: string) => void;
}

export function TagManagerView({
  tags,
  items,
  boughtItems,
  workspaceCurrency = "₴",
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onViewInGrid,
}: TagManagerViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<TagColor>("slate");
  const [search, setSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filteredTags = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tags.filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [tags, search]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onCreateTag(newName.trim(), newColor);
    setNewName("");
    setShowForm(false);
  };

  const commitRename = async (tagId: string) => {
    if (renameValue.trim()) {
      await onUpdateTag(tagId, { name: renameValue.trim() });
    }
    setRenamingId(null);
  };

  const getTagStats = (tag: Tag) => {
    const linkedActive = items.filter((i) => i.tag_ids.includes(tag.tag_id));
    const linkedBought = boughtItems.filter((b) =>
      b.tag_ids.includes(tag.tag_id),
    );
    const avgDrop =
      linkedActive.length > 0
        ? linkedActive.reduce((s, i) => s + i.drop_pct, 0) / linkedActive.length
        : 0;
    const savingsText = formatSavingsByCurrency(linkedBought, workspaceCurrency);
    return { activeCount: linkedActive.length, avgDrop, savingsText };
  };

  return (
    <section
      id={ANCHORS.viewTags}
      aria-label="Tag Manager"
      className="mx-auto min-w-0 max-w-4xl space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-zinc-950">
              Tag Manager
            </h1>
            <p className="tabular-nums text-xs text-zinc-500">
              Total Active Tags: {tags.length}
            </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="tag-manager-search" className="sr-only">
            Search tags
          </label>
          <input
            id="tag-manager-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tags..."
            className="min-h-11 w-full rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-950 sm:min-h-9 sm:w-52"
          />
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            aria-expanded={showForm}
            className="min-h-11 rounded-lg bg-zinc-950 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-800 sm:min-h-9"
          >
            + Create New Tag
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3.5 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor="new-tag-name"
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
            >
              Tag Name
            </label>
            <input
              id="new-tag-name"
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Black Friday"
              className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-9"
            />
          </div>
          <div>
            <label
              htmlFor="new-tag-color"
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
            >
              Color Theme
            </label>
            <select
              id="new-tag-color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value as TagColor)}
              className={`min-h-11 w-full rounded-lg border px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-zinc-950 sm:min-h-9 ${TAG_BADGE_CLASSES[newColor]}`}
            >
              {TAG_COLOR_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-zinc-950 px-4 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 sm:min-h-9"
          >
            Save Tag
          </button>
        </form>
      )}

      {/* Mobile-first tag cards (< 768px) */}
      <div className="min-w-0 space-y-2.5 md:hidden">
        {filteredTags.map((tag) => {
          const { activeCount, avgDrop, savingsText } = getTagStats(tag);
          return (
            <article
              key={tag.tag_id}
              className="min-w-0 space-y-2.5 rounded-xl border border-gray-200 bg-white p-3.5 text-xs"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                {renamingId === tag.tag_id ? (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <label
                      htmlFor={`mobile-rename-${tag.tag_id}`}
                      className="sr-only"
                    >
                      New name for {tag.name}
                    </label>
                    <input
                      id={`mobile-rename-${tag.tag_id}`}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="min-h-11 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-zinc-950 sm:min-h-9"
                    />
                    <button
                      type="button"
                      onClick={() => void commitRename(tag.tag_id)}
                      className="min-h-11 shrink-0 rounded-lg bg-zinc-950 px-3 py-1 text-[11px] font-semibold text-white sm:min-h-9"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${TAG_BADGE_CLASSES[tag.color]}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 rounded-full ${TAG_DOT_CLASSES[tag.color]}`}
                    />
                    {tag.name}
                  </span>
                )}
                <span className="tabular-nums text-zinc-500">
                  {activeCount} active
                </span>
              </div>

              <div className="tabular-nums flex items-center justify-between text-zinc-600">
                <span>Avg drop: -{avgDrop.toFixed(1)}%</span>
                <span>
                  Saved:{" "}
                  <strong className="font-semibold text-zinc-950">
                    {savingsText}
                  </strong>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label
                  htmlFor={`mobile-color-${tag.tag_id}`}
                  className="sr-only"
                >
                  Color theme for {tag.name}
                </label>
                <select
                  id={`mobile-color-${tag.tag_id}`}
                  value={tag.color}
                  onChange={(e) =>
                    void onUpdateTag(tag.tag_id, {
                      color: e.target.value as TagColor,
                    })
                  }
                  className={`min-h-11 rounded-lg border px-2.5 py-1 text-xs font-medium sm:min-h-9 ${TAG_BADGE_CLASSES[tag.color]}`}
                >
                  {TAG_COLOR_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onViewInGrid(tag.tag_id)}
                  className="min-h-11 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-950 hover:bg-gray-50 sm:min-h-9"
                >
                  View in Grid &rarr;
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenamingId(tag.tag_id);
                    setRenameValue(tag.name);
                  }}
                  className="min-h-11 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-gray-100 sm:min-h-9"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteTag(tag.tag_id)}
                  className="min-h-11 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:min-h-9"
                >
                  Delete
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Desktop 2-column table (>= 768px) */}
                <div
                  data-scroll-container="true"
                  className="hidden overflow-x-auto rounded-xl border border-gray-200 md:block"
                >
                        <table className="w-full border-collapse text-left text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50/50 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                              <th className="px-4 py-2.5">Tag Name</th>
                              <th className="px-4 py-2.5">Additional Info &amp; Edit Options</th>
                            </tr>
                          </thead>
                            <tbody className="divide-y divide-gray-200">
                              {filteredTags.map((tag) => {
                                const { activeCount, avgDrop, savingsText } = getTagStats(tag);
                                return (
                                      <tr key={tag.tag_id} className="hover:bg-gray-50/60">
                                        <td className="px-4 py-3.5 align-middle">
                                          {renamingId === tag.tag_id ? (
                                            <div className="flex items-center gap-2">
                                              <label
                                                htmlFor={`rename-${tag.tag_id}`}
                                                className="sr-only"
                                              >
                                                New name for {tag.name}
                                              </label>
                                              <input
                                                id={`rename-${tag.tag_id}`}
                                                type="text"
                                                value={renameValue}
                                                onChange={(e) => setRenameValue(e.target.value)}
                                                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-zinc-950"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => void commitRename(tag.tag_id)}
                                                className="rounded-lg bg-zinc-950 px-2.5 py-1 text-[11px] font-semibold text-white"
                                              >
                                                Save
                                              </button>
                                            </div>
                                          ) : (
                      <span
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${TAG_BADGE_CLASSES[tag.color]}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${TAG_DOT_CLASSES[tag.color]}`}
                        />
                        {tag.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="tabular-nums flex flex-wrap items-center gap-3 text-zinc-500">
                        <span>
                          <strong className="font-medium text-zinc-950">
                            {activeCount}
                          </strong>{" "}
                          active
                        </span>
                        <span aria-hidden="true">&middot;</span>
                        <span>Avg drop: -{avgDrop.toFixed(1)}%</span>
                        <span aria-hidden="true">&middot;</span>
                        <span>
                          Saved:{" "}
                          <strong className="font-medium text-zinc-950">
                            {savingsText}
                          </strong>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`color-${tag.tag_id}`}
                          className="sr-only"
                        >
                          Color theme for {tag.name}
                        </label>
                        <select
                          id={`color-${tag.tag_id}`}
                          value={tag.color}
                          onChange={(e) =>
                            void onUpdateTag(tag.tag_id, {
                              color: e.target.value as TagColor,
                            })
                          }
                          className={`h-8 rounded-lg border px-2 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-zinc-950 ${TAG_BADGE_CLASSES[tag.color]}`}
                        >
                          {TAG_COLOR_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => onViewInGrid(tag.tag_id)}
                          className="h-8 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-zinc-950 hover:bg-gray-50"
                        >
                          View in Grid &rarr;
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(tag.tag_id);
                            setRenameValue(tag.name);
                          }}
                          className="h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-600 hover:bg-gray-100"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteTag(tag.tag_id)}
                          className="h-8 rounded-lg px-2.5 text-xs font-medium text-zinc-400 hover:bg-red-50 hover:text-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
                                          );
            })}
                                        </tbody>
                                      </table>
                                    </div>
                                  </section>
                                );
                              }
