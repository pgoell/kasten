import { type RefObject, useEffect, useState } from "react";

/**
 * Pads a box clear of an on-screen keyboard: iOS keeps the layout height, so only the visual
 * viewport shows what is in sight. Also sets `--keyboard`, which reaches `fixed` children.
 * One box only: a second reader would measure after the first had made room.
 * Returns whether a keyboard is up.
 */
export function useKeyboardInset(box: RefObject<HTMLElement | null>, on: boolean): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const element = box.current;
    const viewport = window.visualViewport;
    if (!on || element === null || !viewport) return;

    const clear = () => {
      const { bottom } = element.getBoundingClientRect();
      // The visual viewport shows `height` pixels from `offsetTop`, which without a keyboard is
      // the whole clientHeight / scale. A zoom alone covers nothing, as Safari zooms on focus.
      const shown = document.documentElement.clientHeight / viewport.scale;
      const covered = Math.min(shown, bottom - viewport.offsetTop) - viewport.height;
      const pixels = Math.max(0, Math.round(covered));
      element.style.paddingBottom = `${pixels}px`;
      element.style.setProperty("--keyboard", `${pixels}px`);
      setUp(pixels > 0);
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
  return on && up;
}
