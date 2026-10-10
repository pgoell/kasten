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
      // Unzoomed, what shows is the layout from `offsetTop` down, iOS panning
      // the page under an open keyboard. Zoomed, `offsetTop` is where the
      // reader has panned to and says nothing about a keyboard. What does is
      // how much shorter the visual viewport is than a zoom alone would make
      // it, `clientHeight / scale`. That difference is what the keyboard
      // covers in the layout's own pixels: a keyboard K tall on the glass
      // hides K divided by the scale of them. The frame is the page, so its
      // foot is the layout's. Safari zooms by itself on the focus of a small
      // input and stays zoomed, so reading a zoom as "no keyboard" would turn
      // this off until a pinch.
      const zoomed = Math.abs(viewport.scale - 1) > 0.01;
      const covered = zoomed
        ? document.documentElement.clientHeight / viewport.scale - viewport.height
        : bottom - (viewport.offsetTop + viewport.height);
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
