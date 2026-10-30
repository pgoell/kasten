import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * The pane width from which the right margin draws. `reader.css` uses the same number, so the
 * Graph button and the margin never disappear at different widths.
 */
export const RIGHT_MARGIN_FROM = 1320;

/**
 * Whether the element is at least `RIGHT_MARGIN_FROM` wide; false until measured. Checked on
 * every render, since a pane's element can mount later, once a note opens in it.
 */
export function usePaneWide(ref: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);
  const watching = useRef<{ element: HTMLElement; watch: ResizeObserver } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === (watching.current?.element ?? null)) return;
    watching.current?.watch.disconnect();
    watching.current = null;
    if (element === null) {
      setWide(false);
      return;
    }

    const watch = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= RIGHT_MARGIN_FROM);
    });
    watch.observe(element);
    watching.current = { element, watch };
  });

  useEffect(
    () => () => {
      watching.current?.watch.disconnect();
      watching.current = null;
    },
    [],
  );

  return wide;
}
