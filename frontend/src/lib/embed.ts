/**
 * `![[note]]`, one note drawn inside another.
 *
 * What the widget in `live-preview-embeds.ts` needs from outside the editor: a way to
 * read the note it shows and to open it, and how deep in a chain of embeds it
 * sits. The parsing of the target is in `wikilink.ts`, beside the rule that
 * resolves it, and the slicing of a section in `note-section.ts`.
 */

import { Facet } from "@codemirror/state";
import {
  hashKey,
  type QueryClient,
  QueryObserver,
  type QueryObserverResult,
} from "@tanstack/react-query";
import { fetchNote } from "@/lib/api";
import { encodePath } from "@/lib/note-path";
import { namesAFile } from "@/lib/wikilink";

/** Hands an embed the text of its note, now and on every later change. */
export interface EmbedSource {
  /**
   * Calls `listener` with the note's text once it is read, null when the vault
   * holds no such note or the read failed, and again each time the text
   * changes. Returns what stops the calls.
   */
  watch(path: string, listener: (text: string | null) => void): () => void;
  /** Opens the note in the focused pane, at a 1-based line when given; a pdf beside it at that page. */
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
  openPdf: (path: string, page?: number) => void,
): EmbedSource {
  return {
    watch(path, listener) {
      const queryKey = ["note", path];
      const hash = hashKey(queryKey);
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
      const arm = () => {
        const observer = new QueryObserver<string>(client, {
          queryKey,
          queryFn: () => fetchNote(path),
          retry: false,
        });
        const stop = observer.subscribe(report);
        // A note already in the cache is no change, so the observer says
        // nothing about it until it is read again.
        report(observer.getCurrentResult());
        return stop;
      };
      let stopObserver: (() => void) | null = arm();
      // Trashing a note removes its query, and an observer stays on the query
      // it was built with: it would hear nothing more and the embed would go
      // on drawing the trashed body. So the cache is watched for that removal,
      // and for the key coming back, which is the note restored and read again.
      const stopCache = client.getQueryCache().subscribe((event) => {
        if (event.query.queryHash !== hash) return;
        if (event.type === "removed" && stopObserver) {
          stopObserver();
          stopObserver = null;
          last = null;
          listener(null);
        } else if (event.type === "added" && !stopObserver) {
          stopObserver = arm();
        }
      });
      return () => {
        stopObserver?.();
        stopObserver = null;
        stopCache();
      };
    },
    // A pdf goes to kasten's own pdf view and not a browser tab, a phone's
    // viewer ignoring `#page` (#353). Any other file goes where `gf` sends
    // one, a tab of its own: the route's `open` reads every path as a note and
    // would open the file's bytes as text.
    open(path, line) {
      if (path.toLowerCase().endsWith(".pdf")) openPdf(path, line);
      else if (namesAFile(path)) window.open(`/api/assets/${encodePath(path)}`, "_blank");
      else open(path, line);
    },
  };
}
