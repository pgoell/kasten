import type { MouseEvent } from "react";
import { LABEL, TAP } from "@/lib/overlay-styles";
import type { Facet, Filters } from "@/lib/search-facets";

interface SearchFiltersProps {
  /** Counts over the whole answer, so they do not move as a choice narrows it. */
  facets: { folders: Facet[]; tags: Facet[] };
  filters: Filters;
  archive: boolean;
  /** Archive lines for the query, or undefined while they are still being asked for. */
  archived: number | undefined;
  onFolder: (folder: string) => void;
  onTag: (tag: string) => void;
  onArchive: () => void;
}

/** Tapping does not take the focus from the input: the keys have to keep working after it. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** One filter, a button that reads as pressed while it is the choice. */
function FilterRow({
  label,
  count,
  pressed,
  onPress,
}: {
  label: string;
  count: number | undefined;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onMouseDown={keepFocus}
      onClick={onPress}
      className={`${TAP} -ml-2 flex w-[calc(100%+0.5rem)] min-w-0 cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-k-13 ${pressed ? "bg-k-surface text-k-accent" : "text-k-ink"}`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 font-mono text-k-12 text-k-muted">{count}</span>
    </button>
  );
}

/**
 * The three groups the column narrows the lines by: folders and tags, one of
 * each at a time, and the archive as a switch of its own.
 */
export function SearchFilters({
  facets,
  filters,
  archive,
  archived,
  onFolder,
  onTag,
  onArchive,
}: SearchFiltersProps) {
  return (
    <div className="flex flex-col gap-5 font-sans">
      <fieldset className="flex flex-col gap-0.5">
        <legend className={LABEL}>Folders</legend>
        {facets.folders.map((folder) => (
          <FilterRow
            key={folder.name}
            // The vault's root has no name, so it is drawn as the slash it is.
            label={folder.name === "" ? "/" : folder.name}
            count={folder.count}
            pressed={filters.folder === folder.name}
            onPress={() => onFolder(folder.name)}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-0.5">
        <legend className={LABEL}>Tags</legend>
        {facets.tags.map((tag) => (
          <FilterRow
            key={tag.name}
            label={tag.name}
            count={tag.count}
            pressed={filters.tag === tag.name}
            onPress={() => onTag(tag.name)}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-0.5">
        <legend className="sr-only">Archive</legend>
        <FilterRow
          label="Include the archive"
          count={archived}
          pressed={archive}
          onPress={onArchive}
        />
      </fieldset>
    </div>
  );
}
