/**
 * `![[note]]`, one note drawn inside another.
 *
 * What the widget in `live-preview.ts` needs from outside the editor: a way to
 * read the note it shows and to open it, and how deep in a chain of embeds it
 * sits. The parsing of the target is in `wikilink.ts`, beside the rule that
 * resolves it, and the slicing of a section in `note-section.ts`.
 */

import { Facet } from "@codemirror/state";
import { type QueryClient, QueryObserver, type QueryObserverResult } from "@tanstack/react-query";
import { fetchNote } from "@/lib/api";

/** Hands an embed the text of its note, now and on every later change. */
export interface EmbedSource {
  /**
   * Calls `listener` with the note's text once it is read, null when the vault
   * holds no such note or the read failed, and again each time the text
   * changes. Returns what stops the calls.
   */
  watch(path: string, listener: (text: string | null) => void): () => void;
  /** Opens the note in the focused pane, at a 1-based line when given. */
  open(path: string, line?: number): void;
}

/**
 * The source, carried on the editor state.
 *
 * Null by default, and the difference from a source that answers null matters
 * the way it does for `vaultPaths`: a view nobody told how to read the vault,
 * which the finder's preview pane is, shows the embed as its source rather
 * than calling every note it names missing.
 */
export const embedSource = Facet.define<EmbedSource, EmbedSource | null>({
  combine: (values) => values[0] ?? null,
});

/** How many embeds the view sits inside. The note being edited is depth 0. */
export const embedDepth = Facet.define<number, number>({
  combine: (values) => values[0] ?? 0,
});

/**
 * How deep embeds nest before the next one is drawn as a stub.
 *
 * A note that embeds a note that embeds it would otherwise draw itself without
 * end. A cap rather than a check for a repeated path, because a cap also stops a
 * long honest chain from building views nobody scrolls to.
 */
export const EMBED_DEPTH = 3;

/**
 * A source that reads each note through the query cache.
 *
 * The key is the one the note's own pane reads, `["note", path]`, and that is
 * the whole of keeping an embed current: the route refetches that key when the
 * vault reports a write, which reaches every key somebody observes, and the
 * autosave puts the note it wrote straight into it. An embed of the note open
 * beside it changes as you type there, a save later, with no wiring of its own.
 *
 * No retry, because a note that is not there answers 404 and asking twice more
 * only delays the stub. `open` goes to whoever built this, which is the route:
 * only it knows which pane is focused.
 */
export function queryEmbedSource(
  client: QueryClient,
  open: (path: string, line?: number) => void,
): EmbedSource {
  return {
    watch(path, listener) {
      const observer = new QueryObserver<string>(client, {
        queryKey: ["note", path],
        queryFn: () => fetchNote(path),
        retry: false,
      });
      // The observer reports every change of its result, fetching flags and
      // all, and the widget redraws on each call, so only a new answer passes.
      let last: string | null | undefined;
      const report = (result: QueryObserverResult<string>) => {
        // A refetch that fails keeps the text it had: a dropped connection is
        // no reason to call a note on screen missing.
        const text = result.data ?? (result.status === "error" ? null : undefined);
        if (text === undefined || text === last) return;
        last = text;
        listener(text);
      };
      const stop = observer.subscribe(report);
      // A note already in the cache is no change, so the observer says nothing
      // about it until it is read again.
      report(observer.getCurrentResult());
      return stop;
    },
    open,
  };
}
