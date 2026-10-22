import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * The pane width from which the right margin draws, and the local graph with it.
 *
 * reader.css's container query uses the same number: the two change together or
 * the Graph button and the margin disappear at different widths.
 */
export const RIGHT_MARGIN_FROM = 1320;

/**
 * Whether the element is at least `RIGHT_MARGIN_FROM` wide. False until the first
 * measurement, so nothing is asked for before the pane is known to be wide.
 *
 * Runs on every render rather than on a fixed list, because the element can mount
 * later: a pane that holds no note has no reader until one opens in it.
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
