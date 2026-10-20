import { Annotation, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { setWatched } from "@/lib/video";

/**
 * Marks the transaction that puts the vault's own text in.
 *
 * The listener below reports every other change, and reporting this one would
 * have the note saved back: that stamps a new date, which is another change to
 * the vault, which reloads here, which saves again. A note nobody touched would
 * rewrite itself once a second.
 */
export const fromVault = Annotation.define<boolean>();

/**
 * Put the vault's text in the buffer, replacing only the span that differs.
 *
 * Never the whole document. CodeMirror maps positions through a change, so
 * everything outside the span comes through where it was: the cursor stays on
 * the words it sat on, and an undo of an edit the reader made puts the text
 * back where they made it. Replaced whole, both collapse to the one point the
 * replacement leaves, which is what a reload used to cost. Nothing is asked of
 * the selection here for the same reason: mapping keeps it, and naming it would
 * flatten it.
 *
 * The vault's own writes are what make this cheap. An agent appends, an editor
 * rewrites a paragraph, and kasten's `modified` stamp moves one line of the
 * frontmatter.
 *
 * `allowed` is asked at the last moment, even when there is no change to make,
 * and a no leaves the note as it stands and the vault as it stands. Absent means
 * nobody is holding text the change could take off the screen.
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

  // Both ends stop at `from`, so the tail cannot walk back into the head it
  // already matched: "aaa" grown to "aaaaa" shares its whole length with itself
  // either way round, and subtracting both would delete text that is still
  // there.
  let to = current.length;
  let insertTo = text.length;
  while (to > from && insertTo > from && current[to - 1] === text[insertTo - 1]) {
    to -= 1;
    insertTo -= 1;
  }

  // Asked even when the text is already on screen: equal text is still an
  // answer the autosave needs, since the vault coming to hold the buffer's
  // text settles a conflict or a held entry over it.
  if (allowed?.(text) === false) return;
  // Nothing left after the trim is the text already on screen, which is what
  // mounting looks like from here: the note opens on the same query data the
  // reload prop carries. A change holding nothing is still a transaction.
  if (from === to && from === insertTo) return;

  view.dispatch({
    changes: { from, to, insert: text.slice(from, insertTo) },
    // Off the undo stack as well as off the save path. Undoing a write nobody
    // here made would put the text from before it back, and that revert carries
    // no annotation, so autosave would send it to the vault: one `u`
    // overwriting whatever the other writer had just done.
    annotations: [fromVault.of(true), Transaction.addToHistory.of(false)],
  });
}

/** Writes a video position into the frontmatter of the note in the buffer. */
export function writeWatched(view: EditorView, mark: { id: string; seconds: number }): void {
  const held = view.state.doc.toString();
  const wanted = setWatched(held, mark.id, mark.seconds);
  if (wanted === held) return;

  // The smallest change that gets there, rather than replacing the document.
  // A whole-document replace maps the cursor to nowhere in particular and
  // would move it out from under whoever is typing; this touches the
  // frontmatter block alone, so a cursor below it does not move at all.
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
    // Nobody typed this, so `u` must not undo it. An edit in the history would
    // also put the position back the moment you undid a sentence.
    annotations: Transaction.addToHistory.of(false),
  });
}
