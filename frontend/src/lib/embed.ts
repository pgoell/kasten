/**
 * `![[note]]`, one note drawn inside another. The widget in `live-preview-embeds.ts` needs a way
 * to read and open the note, and how deep it sits in a chain of embeds.
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
  /** Opens the note in the focused pane at a 1-based line; a pdf opens at its page. */
  open(path: string, line?: number): void;
}

/**
 * Null by default, which differs from a source that answers null: a view with no vault reader,
 * like the finder's preview, shows the embed as a source rather than calling every note missing.
 */
export const embedSource = Facet.define<EmbedSource, EmbedSource | null>({
  combine: (values) => values[0] ?? null,
});

/** How many embeds the view sits inside. The note being edited is depth 0. */
export const embedDepth = Facet.define<number, number>({
  combine: (values) => values[0] ?? 0,
});

/**
 * How deep embeds nest before the next draws as a stub. A self-embedding note would otherwise draw
 * forever, and the cap also spares a long honest chain views nobody scrolls to.
 */
export const EMBED_DEPTH = 3;

/**
 * Reads each note through the query cache under `["note", path]`, the key the note's own pane uses.
 * That shared key keeps an embed current: a vault write refetches it, and autosaves land in it.
 * No retry, since a missing note answers 404 and retrying only delays the stub. `open` is the
 * route's, since only it knows the focused pane.
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
      // The observer fires on every state change, fetch flags included; only a new text passes.
      let last: string | null | undefined;
      const report = (result: QueryObserverResult<string>) => {
        // A failed refetch keeps the old text: a dropped connection is no cause to call it missing.
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
        // A cached note fires nothing on subscribe, so report it now.
        report(observer.getCurrentResult());
        return stop;
      };
      let stopObserver: (() => void) | null = arm();
      // Trashing removes the query, but an observer stays on its old query and the embed would keep
      // the trashed body. So the cache is watched for that removal, and for the key coming back.
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
    // A pdf goes to kasten's own viewer, since phone viewers ignore `#page` (#353). Other files
    // get a tab, since `open` would read their bytes as note text.
    open(path, line) {
      if (path.toLowerCase().endsWith(".pdf")) openPdf(path, line);
      else if (namesAFile(path)) window.open(`/api/assets/${encodePath(path)}`, "_blank");
      else open(path, line);
    },
  };
}
