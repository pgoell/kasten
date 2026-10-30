import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { onPageWritten } from "@/lib/html/page-written";

/** A scroll the page reported, with the page it belongs to. */
interface Place {
  path: string;
  top: number;
}

/**
 * Reload the html pane's page when the vault rewrites it (#1277). A new frame keyed by `loads`
 * leaves no history entry, unlike a new `src`. The last scroll and focus are restored after load.
 */
export function usePageReload(
  path: string,
  frame: RefObject<HTMLIFrameElement | null>,
  relayedTaken: RefObject<boolean>,
  forget: () => void,
) {
  const [loads, setLoads] = useState(0);
  const pathRef = useRef(path);
  const last = useRef<Place | null>(null);
  /**
   * Whether the frame holds the page at `path`. Off from a move to another page
   * until its load, so a report the old page posted late is not filed under the
   * new one: the frame's window is the same object across a new `src`.
   */
  const live = useRef(true);
  useLayoutEffect(() => {
    if (pathRef.current === path) return;
    pathRef.current = path;
    last.current = null;
    restore.current = null;
    live.current = false;
  });
  /**
   * The scroll to give the next load, taken when the rewrite is heard: by the
   * load the new page may have jumped to a heading and reported that instead.
   */
  const restore = useRef<Place | null>(null);
  const refocus = useRef(false);
  const forgetRef = useRef(forget);
  useLayoutEffect(() => {
    forgetRef.current = forget;
  });

  // Where the page has scrolled to, as its script reports it, from this pane's
  // frame only. Heard whatever has the focus: a wheel scrolls a page without it.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { kasten?: unknown; top?: unknown } | null;
      if (data?.kasten !== "scroll" || typeof data.top !== "number" || !live.current) return;
      last.current = { path: pathRef.current, top: data.top };
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame]);

  useEffect(
    () =>
      onPageWritten((written) => {
        if (written !== pathRef.current) return;
        if (last.current?.path === written) restore.current ??= last.current;
        refocus.current ||= document.activeElement === frame.current;
        // A new page is a new visit, so the page's own `y` takes once more.
        relayedTaken.current = false;
        // The old page goes with its frame, so what it held goes now: the new page
        // runs its script, draws and takes presses well before its load (#1293).
        forgetRef.current();
        setLoads((count) => count + 1);
      }),
    [frame, relayedTaken],
  );

  return {
    loads,
    /** The frame's load: the scroll and the focus a reload took away go back. */
    loaded() {
      live.current = true;
      const place = restore.current;
      restore.current = null;
      if (place !== null && place.path === pathRef.current) {
        frame.current?.contentWindow?.postMessage({ kasten: "scroll", top: place.top }, "*");
      }
      // Not where the reader has gone on to another pane while the page loaded.
      const free = document.activeElement === null || document.activeElement === document.body;
      if (refocus.current && free) frame.current?.focus();
      refocus.current = false;
    },
  };
}
