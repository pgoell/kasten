import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { onPageWritten } from "@/lib/html/page-written";

/** A scroll the page reported, with the page it belongs to. */
interface Place {
  path: string;
  top: number;
}

/**
 * The html pane's page loaded again when the vault says it was rewritten (#1277).
 *
 * `loads` keys the frame: a new frame loads the page afresh and, unlike a new
 * `src` on the old one, leaves no entry in the browser's history. The scroll the
 * page last reported goes back to it once it has loaded, and so does the focus
 * where the frame held it. Each place carries its path, so a pane moved to
 * another page does not hand that page the last one's scroll.
 */
export function usePageReload(
  path: string,
  frame: RefObject<HTMLIFrameElement | null>,
  relayedTaken: RefObject<boolean>,
) {
  const [loads, setLoads] = useState(0);
  const pathRef = useRef(path);
  useLayoutEffect(() => {
    pathRef.current = path;
  });
  const last = useRef<Place | null>(null);
  /**
   * The scroll to give the next load, taken when the rewrite is heard: by the
   * load the new page may have jumped to a heading and reported that instead.
   */
  const restore = useRef<Place | null>(null);
  const refocus = useRef(false);

  // Where the page has scrolled to, as its script reports it, from this pane's
  // frame only. Heard whatever has the focus: a wheel scrolls a page without it.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { kasten?: unknown; top?: unknown } | null;
      if (data?.kasten !== "scroll" || typeof data.top !== "number") return;
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
        setLoads((count) => count + 1);
      }),
    [frame, relayedTaken],
  );

  return {
    loads,
    /** The frame's load: the scroll and the focus a reload took away go back. */
    loaded() {
      const place = restore.current;
      restore.current = null;
      if (place !== null && place.path === pathRef.current) {
        frame.current?.contentWindow?.postMessage({ kasten: "scroll", top: place.top }, "*");
      }
      if (refocus.current) {
        refocus.current = false;
        frame.current?.focus();
      }
    },
  };
}
