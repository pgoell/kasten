import { type RefObject, useEffect, useRef, useState } from "react";

// A browser refusing a request rejects with a TypeError and changes nothing,
// so the pane stays as it was.
function refused(error: unknown) {
  if (!(error instanceof TypeError)) throw error;
}

/**
 * Full screen for one box in a pane. The box must sit inside the pane, so keys
 * pressed in it bubble up to the pane's handler.
 */
export function useFullScreen(
  box: RefObject<HTMLElement | null>,
  pane: RefObject<HTMLElement | null>,
) {
  /** Whether the box is the document's full-screen element. */
  const [full, setFull] = useState(false);
  // Safari on an iPhone has no full screen for a box, only for its video, so the
  // caller draws no button there.
  const canFull = document.fullscreenEnabled === true;
  /** What runs once the exit `exitThen` asked for has landed. */
  const afterExit = useRef<(() => void) | null>(null);

  // Followed, not set by the toggle: Esc leaves full screen with no key event.
  // Focus returns to the pane only if this box was full and focus stayed in it.
  useEffect(() => {
    let was = false;
    function follow() {
      const now = box.current !== null && document.fullscreenElement === box.current;
      const focused = document.activeElement;
      const stayed =
        focused === null || focused === document.body || box.current?.contains(focused);
      if (now) box.current?.focus();
      else if (was && stayed) pane.current?.focus();
      was = now;
      setFull(now);
      const after = afterExit.current;
      afterExit.current = null;
      if (!now) after?.();
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
    asked.catch(refused);
  }

  /**
   * Out of full screen, then `after`, run once the change has landed and handed
   * the focus back: the page outside the box takes no focus before it (#2160).
   */
  function exitThen(after: () => void) {
    afterExit.current = after;
    document.exitFullscreen().catch((error: unknown) => {
      refused(error);
      afterExit.current = null;
      after();
    });
  }

  /** The focus back where the keys are read: the box while it is full screen, else the pane. */
  function refocus() {
    const element = box.current;
    if (element !== null && document.fullscreenElement === element) element.focus();
    else pane.current?.focus();
  }

  return { full, canFull, toggleFull, exitThen, refocus };
}
