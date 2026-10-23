import { tagVariable } from "@/lib/graph";
import type { GraphMode } from "@/lib/graph-mode";
import type { TagCount } from "@/lib/graph-tags";
import { LABEL } from "@/lib/overlay-styles";

/** The note the card shows: the one under the pointer, or the one a finger picked. */
export interface PanelCard {
  path: string;
  name: string;
  missing: boolean;
  tags: string[];
  /** How many links touch it in the drawing. */
  links: number;
}

interface GraphPanelProps {
  /** The notes and links the canvas is given, after the filter and the hidden tags. */
  notes: number;
  links: number;
  archive: boolean;
  mode: GraphMode;
  onMode: (mode: GraphMode) => void;
  tags: TagCount[];
  /** The keys of the tags taken out of the drawing. */
  hidden: Set<string>;
  onToggleTag: (key: string) => void;
  card: PanelCard | null;
  /** Opens the card's note, or makes it when nobody has written it. */
  onOpen: () => void;
}

const READING: Record<GraphMode, string> = {
  folders: "Places are folders. Colour is the first tag, a ring each further tag.",
  tags: "Places are tags. Colour is the first tag, a ring each further tag.",
};

const MODES: { mode: GraphMode; label: string }[] = [
  { mode: "folders", label: "Folders" },
  { mode: "tags", label: "Tags" },
];

/** A note's folder: the path without the file, or the vault root for a note in none. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "vault root" : path.slice(0, slash);
}

/**
 * The side panel of the vault graph: what is drawn, how to read it, the grouping
 * toggle, the tags, and the note the pointer or a finger is on.
 *
 * It sits beside the canvas from 640 px, and under it below that, where its
 * container query takes the full width and at most 45% of the height.
 */
export function GraphPanel({
  notes,
  links,
  archive,
  mode,
  onMode,
  tags,
  hidden,
  onToggleTag,
  card,
  onOpen,
}: GraphPanelProps) {
  return (
    <aside
      aria-label="graph panel"
      className="flex min-h-0 shrink-0 flex-col gap-4 overflow-y-auto border-l border-k-rule px-3 py-3 w-[300px] @max-[640px]:w-full @max-[640px]:max-h-[45%] @max-[640px]:border-l-0 @max-[640px]:border-t"
    >
      <h2 className="font-serif text-[17px] text-k-ink">Vault graph</h2>
      <p className="text-[12px] text-k-ink">
        {`${notes} notes and ${links} links. ${archive ? "The archive is in." : "The archive is left out."}`}
      </p>
      <p className="text-[12px] text-k-muted">{READING[mode]}</p>

      <fieldset
        aria-label="mode"
        className="flex self-start overflow-hidden rounded-[var(--k-radius-6)] border border-k-rule text-k-13"
      >
        {MODES.map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={mode === option.mode}
            onClick={() => onMode(option.mode)}
            className={`k-depth px-3 py-1 pointer-coarse:min-h-11 ${mode === option.mode ? "bg-k-surface text-k-ink" : "text-k-muted"}`}
          >
            {option.label}
          </button>
        ))}
      </fieldset>

      <section className="flex flex-col gap-1">
        <p className={LABEL}>Tags</p>
        <ul aria-label="tags" className="flex flex-col">
          {tags.map(({ tag, key, count }) => {
            const shown = !hidden.has(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={shown}
                  onClick={() => onToggleTag(key)}
                  className={`flex w-full items-center gap-2 px-1 py-0.5 text-left text-[12px] text-k-ink hover:bg-k-surface pointer-coarse:min-h-11 ${shown ? "" : "text-k-muted line-through opacity-50"}`}
                >
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ background: `var(${tagVariable(tag)})` }}
                  />
                  <span className="min-w-0 flex-1 truncate">{tag}</span>{" "}
                  <span className="tabular-nums">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-col gap-1 border-t border-k-rule pt-3">
        {card === null ? (
          <p className="text-[12px] text-k-muted">Hover or tap a note.</p>
        ) : (
          <>
            <p className="font-serif text-[15px] text-k-ink">{card.name}</p>
            <p className="font-mono text-[11px] text-k-muted">
              {card.missing ? "not written yet" : folderOf(card.path)}
            </p>
            {card.tags.length > 0 && (
              <p className="flex flex-wrap gap-x-2 text-[12px] text-k-ink">
                {card.tags.map((tag) => (
                  <span key={tag} className="flex items-center gap-1">
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: `var(${tagVariable(tag)})` }}
                    />
                    {tag}
                  </span>
                ))}
              </p>
            )}
            <p className="text-[12px] text-k-muted">{`${card.links} links in the drawing`}</p>
            <button
              type="button"
              onClick={onOpen}
              className="mt-1 min-h-11 self-start text-[13px] text-k-accent"
            >
              Open
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
