import { plainLinks, wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

/**
 * The person note an assignee names, or null where it names none.
 *
 * Resolved the way a person card's rows are, so the chip and the card agree on
 * which note a todo is for. A plain name is no link, so it has no note.
 */
export function personNote(assignee: string, paths: string[]): string | null {
  const [target] = wikiLinkTargets(assignee);
  if (target === undefined) return null;
  const path = wikiLinkPath(target, paths);
  return paths.includes(path) ? path : null;
}

/**
 * The person note a press landed on, or null where it hit no chip with one.
 *
 * The row and the card around a chip are buttons, and a button cannot hold
 * another, so the chip has no handler. Its press comes up to the row, which asks
 * here first and opens the note when there is one.
 */
export function chipNote(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-person-path]")?.dataset.personPath ?? null;
}

/** The pill itself. It takes the text size of the line it sits on. */
const PILL =
  "block min-w-0 truncate rounded-full px-[var(--k-space-8)] transition-colors duration-150 motion-reduce:transition-none motion-reduce:duration-0";

/** A name with a note: a filled pill that reads as a link. */
const LINKED = "bg-k-surface text-k-ink hover:bg-k-rule hover:text-k-accent";

/** A name with no note: an outlined pill, muted, so it reads as a name still to be filed. */
const UNLINKED =
  "border border-dashed border-[color-mix(in_srgb,var(--k-rule-strong)_50%,transparent)] text-k-muted hover:bg-k-surface hover:text-k-ink";

/**
 * An assignee drawn as a chip. Its hit area is the whole row's height on a
 * phone, so a tap lands on the chip and not beside it.
 */
export function PersonChip({ assignee, paths }: { assignee: string; paths: string[] }) {
  const note = personNote(assignee, paths);
  return (
    <span
      data-person={assignee}
      data-person-path={note ?? undefined}
      title={assignee}
      className="flex max-w-[40%] shrink-0 items-center self-stretch pointer-coarse:min-h-11"
    >
      <span className={`${PILL} ${note === null ? UNLINKED : LINKED}`}>{plainLinks(assignee)}</span>
    </span>
  );
}
