import { type RefObject, useEffect } from "react";

/**
 * Keep a box clear of an on-screen keyboard that covers the page.
 *
 * Every iOS keyboard does: the layout keeps its height, and only the visual
 * viewport says how much of it is still in sight. Whatever of the box lies
 * under the keyboard is padded away, so what the box holds shrinks into the
 * part that shows. Where the keyboard shrinks the layout instead, as the
 * viewport meta asks of Android, nothing is covered and this pads nothing.
 *
 * The same number goes out as `--keyboard`, for what is drawn `fixed` inside
 * the box: padding does not reach it and a custom property does.
 *
 * One box, the frame of the page. A second reader inside the first would
 * measure after the first had already made room, and find nothing covered.
 */
export function useKeyboardInset(box: RefObject<HTMLElement | null>, on: boolean): void {
  useEffect(() => {
    const element = box.current;
    const viewport = window.visualViewport;
    if (!on || element === null || !viewport) return;

    const clear = () => {
      // A pinch zoom shrinks the visual viewport too, and is not a keyboard.
      const covered =
        viewport.scale === 1
          ? element.getBoundingClientRect().bottom - (viewport.offsetTop + viewport.height)
          : 0;
      const inset = `${Math.max(0, Math.round(covered))}px`;
      element.style.paddingBottom = inset;
      element.style.setProperty("--keyboard", inset);
    };

    clear();
    // `scroll` as well: iOS pans the visual viewport after the keyboard is up.
    viewport.addEventListener("resize", clear);
    viewport.addEventListener("scroll", clear);
    return () => {
      viewport.removeEventListener("resize", clear);
      viewport.removeEventListener("scroll", clear);
      element.style.paddingBottom = "";
      element.style.removeProperty("--keyboard");
    };
  }, [box, on]);
}
