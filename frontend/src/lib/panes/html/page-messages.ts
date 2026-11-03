import type { RefObject } from "react";

/**
 * What a message carries when a pane's own page in `frame` posted it, else null. A nested frame in the
 * page, a window it opened and another pane's frame all reach the window's listener too.
 */
export function pageData(event: MessageEvent, frame: HTMLIFrameElement | null) {
  if (event.source === null || event.source !== frame?.contentWindow) return null;
  if (typeof event.data !== "object" || event.data === null) return null;
  return event.data as Record<string, unknown>;
}

/**
 * The page's `innerText`, asked of its script: the frame has no
 * `allow-same-origin`, so the page is the only thing that can read it. A page
 * that never answers, one whose script a page error stopped, is given up on.
 * `textWait` holds where the answer goes until the page sends it.
 */
export function pageText(
  frame: HTMLIFrameElement | null,
  textWait: RefObject<((text: string) => void) | null>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const page = frame?.contentWindow;
    if (page === null || page === undefined) {
      reject(new Error("The page is not open"));
      return;
    }
    const waiter = (text: string) => {
      clearTimeout(timer);
      textWait.current = null;
      resolve(text);
    };
    // Cleared only while it is still this read's: a reader closed and opened
    // again has put a waiter of its own there since.
    const timer = setTimeout(() => {
      if (textWait.current === waiter) textWait.current = null;
      reject(new Error("The page did not hand over its text"));
    }, 5000);
    textWait.current = waiter;
    page.postMessage({ kasten: "text" }, "*");
  });
}
