import { Annotation, type ChangeSpec, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { setWatched } from "@/lib/panes/video/video";

/**
 * Marks the transaction that puts the vault's own text in. Saving it back would
 * stamp a new date, which reloads the note, which saves again.
 */
export const fromVault = Annotation.define<boolean>();

/**
 * The one span where `wanted` differs from `held`, so the cursor and undo keep their place.
 * An insertion or deletion that fits at several places goes at a line start: a frontmatter block
 * put in at offset 1 of a line starting `-` splits the undo of an edit to that line (#2098), and a
 * table deleted above one with the same head would leave its start, and scroll place, to it (#2341).
 */
function smallestChange(held: string, wanted: string): ChangeSpec | null {
  let from = 0;
  while (from < held.length && from < wanted.length && held[from] === wanted[from]) from += 1;

  // The tail stops at `from`, so it cannot match text the head already took.
  let to = held.length;
  let insertTo = wanted.length;
  while (to > from && insertTo > from && held[to - 1] === wanted[insertTo - 1]) {
    to -= 1;
    insertTo -= 1;
  }
  if (from === to && from === insertTo) return null;

  const moved =
    from === to ? wanted.slice(from, insertTo) : from === insertTo ? held.slice(from, to) : "";
  const line = moved === "" ? -1 : lineStart(held, moved, from);
  if (line < 0) return { from, to, insert: wanted.slice(from, insertTo) };
  if (from === insertTo) return { from: line, to: line + to - from };
  return { from: line, insert: wanted.slice(line, insertTo - (from - line)) };
}

/** The first line start that `text`, put in or taken out at `at`, can slide left to, or -1. */
function lineStart(held: string, text: string, at: number): number {
  let line = at === 0 || held[at - 1] === "\n" ? at : -1;
  // Each step left trades the text's last character for the one before it.
  for (
    let p = at;
    p > 0 && held[p - 1] === text[text.length - 1 - ((at - p) % text.length)];
    p -= 1
  ) {
    if (p === 1 || held[p - 2] === "\n") line = p - 1;
  }
  return line;
}

/**
 * Puts the vault's text in, replacing only the differing span so the cursor and
 * undo keep their place. A `false` from `allowed` leaves the note as it is.
 */
export function takeVaultText(
  view: EditorView,
  text: string,
  allowed?: (text: string) => boolean,
): void {
  const changes = smallestChange(view.state.doc.toString(), text);
  // Asked even when nothing changes: the autosave needs the answer.
  if (allowed?.(text) === false) return;
  // Nothing left after the trim is the text already on screen, as on mount.
  if (changes === null) return;

  view.dispatch({
    changes,
    // Off the undo stack and the save path: an undo here would send old text to the vault.
    annotations: [fromVault.of(true), Transaction.addToHistory.of(false)],
  });
}

/** Writes a video position into the frontmatter of the note in the buffer. */
export function writeWatched(view: EditorView, mark: { id: string; seconds: number }): void {
  const held = view.state.doc.toString();
  const changes = smallestChange(held, setWatched(held, mark.id, mark.seconds));
  if (changes === null) return;

  view.dispatch({
    changes,
    // Nobody typed this, so `u` must not undo it.
    annotations: Transaction.addToHistory.of(false),
  });
}
