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
      const { bottom } = element.getBoundingClientRect();
      // The visual viewport shows the layout from `offsetTop` down for
      // `height` of its pixels. With no keyboard it would show
      // `clientHeight / scale` of them, less under a zoom and all of them
      // without one. What lies between the two feet is what the keyboard
      // hides, as far as the box reaches: panned to its foot, the box has
      // nothing left under the keys. So a zoom alone covers nothing wherever
      // the reader pans, and a keyboard under a zoom covers what it does
      // there. Safari zooms by itself on the focus of a small input, stays
      // zoomed and pans to the input, so both are a phone's ordinary state.
      const shown = document.documentElement.clientHeight / viewport.scale;
      const covered = Math.min(shown, bottom - viewport.offsetTop) - viewport.height;
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
