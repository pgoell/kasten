/**
 * Which html page the vault says was rewritten, for the panes showing it (#1277).
 *
 * The event stream is opened once, by the route, and the panes are mounted
 * wherever the layout puts them, so the news goes through here rather than
 * through props or the query cache: a page is drawn by its frame, and there is
 * no query of it to invalidate.
 */

const listeners = new Set<(path: string) => void>();

/** Calls `listener` with the vault-relative path of every page rewritten from now on. */
export function onPageWritten(listener: (path: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tells every listener the page at `path` was rewritten. */
export function pageWritten(path: string): void {
  for (const listener of listeners) listener(path);
}
