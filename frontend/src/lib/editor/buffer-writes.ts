import { Annotation, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { setWatched } from "@/lib/video/video";

/**
 * Marks the transaction that puts the vault's own text in. Saving it back would
 * stamp a new date, which reloads the note, which saves again.
 */
export const fromVault = Annotation.define<boolean>();

/**
 * Puts the vault's text in, replacing only the differing span so the cursor and
 * undo keep their place. A `false` from `allowed` leaves the note as it is.
 */
export function takeVaultText(
  view: EditorView,
  text: string,
  allowed?: (text: string) => boolean,
): void {
  const current = view.state.doc.toString();
  let from = 0;
  while (from < current.length && from < text.length && current[from] === text[from]) {
    from += 1;
  }

  // The tail stops at `from`, so it cannot match text the head already took.
  let to = current.length;
  let insertTo = text.length;
  while (to > from && insertTo > from && current[to - 1] === text[insertTo - 1]) {
    to -= 1;
    insertTo -= 1;
  }

  // Asked even when nothing changes: the autosave needs the answer.
  if (allowed?.(text) === false) return;
  // Nothing left after the trim is the text already on screen, as on mount.
  if (from === to && from === insertTo) return;

  view.dispatch({
    changes: { from, to, insert: text.slice(from, insertTo) },
    // Off the undo stack and the save path: an undo here would send old text to the vault.
    annotations: [fromVault.of(true), Transaction.addToHistory.of(false)],
  });
}

/** Writes a video position into the frontmatter of the note in the buffer. */
export function writeWatched(view: EditorView, mark: { id: string; seconds: number }): void {
  const held = view.state.doc.toString();
  const wanted = setWatched(held, mark.id, mark.seconds);
  if (wanted === held) return;

  // The smallest change, not a whole-document replace, which would move the cursor.
  let from = 0;
  while (held[from] === wanted[from]) from += 1;
  let tail = 0;
  while (
    tail < Math.min(held.length, wanted.length) - from &&
    held[held.length - 1 - tail] === wanted[wanted.length - 1 - tail]
  ) {
    tail += 1;
  }

  view.dispatch({
    changes: { from, to: held.length - tail, insert: wanted.slice(from, wanted.length - tail) },
    // Nobody typed this, so `u` must not undo it.
    annotations: Transaction.addToHistory.of(false),
  });
}
