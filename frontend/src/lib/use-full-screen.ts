import { type RefObject, useEffect, useState } from "react";

/**
 * Full screen for one box inside a pane, with the focus kept where the keys are read.
 *
 * `box` is what goes full screen and `pane` is where the focus lives otherwise.
 * The box must sit inside the pane, so a key pressed in the box bubbles up to
 * the pane's own handler.
 */
export function useFullScreen(
  box: RefObject<HTMLElement | null>,
  pane: RefObject<HTMLElement | null>,
) {
  /** Whether the box is the document's full-screen element. */
  const [full, setFull] = useState(false);
  // Safari on an iPhone has no full screen for a box, only for its own video
  // element, which a cross-origin frame does not hand out. There the caller
  // draws no button and its key does nothing, rather than a control that does
  // nothing.
  const canFull = document.fullscreenEnabled === true;

  // Followed rather than set by the toggle, because Esc leaves full screen in
  // the browser and no key event says so. The focus goes into the box while it
  // is full screen, since the rest of the pane is not on screen then. It comes
  // back to the pane only when this box was the one full screen, not for
  // another pane's.
  useEffect(() => {
    let was = false;
    function follow() {
      const now = box.current !== null && document.fullscreenElement === box.current;
      if (now) box.current?.focus();
      else if (was) pane.current?.focus();
      was = now;
      setFull(now);
    }
    document.addEventListener("fullscreenchange", follow);
    return () => document.removeEventListener("fullscreenchange", follow);
  }, [box, pane]);

  /**
   * Into full screen, or out of it. Call it straight from the click or the key,
   * since a request made later has lost the user's gesture and is refused.
   */
  function toggleFull() {
    const element = box.current;
    if (element === null || !canFull) return;
    const asked =
      document.fullscreenElement === element
        ? document.exitFullscreen()
        : element.requestFullscreen();
    // A browser refusing the request rejects with a TypeError and changes
    // nothing, so the pane stays as it was.
    asked.catch((error: unknown) => {
      if (!(error instanceof TypeError)) throw error;
    });
  }

  /** The focus back where the keys are read: the box while it is full screen, else the pane. */
  function refocus() {
    const element = box.current;
    if (element !== null && document.fullscreenElement === element) element.focus();
    else pane.current?.focus();
  }

  return { full, canFull, toggleFull, refocus };
}
