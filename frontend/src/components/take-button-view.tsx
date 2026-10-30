import { useLayoutEffect, useRef, useState } from "react";
import { type Anchor, fitButton } from "@/lib/page-selection";
import type { PressHandlers } from "@/lib/take-button";

/**
 * The button's look, the book's `TAKE` in `book-pane.tsx` with the coarse
 * pointer's height from the footer's button. The placement is added per take.
 * Shared by the HTML and the PDF panes, so the two read the same.
 */
const TAKE =
  "absolute flex h-6 -translate-x-1/2 items-center gap-2 rounded border border-k-muted bg-k-bg px-2 font-mono text-k-ink text-xs pointer-coarse:min-h-11";

interface TakeButtonProps {
  /** Where the button goes, from the selection. */
  at: Anchor;
  /** The words after `Take y`, muted: the heading a passage sits under, or the page's number. Empty for none. */
  label: string;
  /** The press guard's handlers, which keep the selection through a press on the button. */
  press: PressHandlers;
  onTake: () => void;
}

/**
 * The take button over a selection. It is measured as drawn, since the fit needs its size and only
 * the DOM knows it. The layout effect sets state only on a change, so it settles in one more render.
 */
export function TakeButton({ at, label, press, onTake }: TakeButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const drawn = button.current;
    if (drawn === null) return;
    if (drawn.offsetWidth !== size.width || drawn.offsetHeight !== size.height) {
      setSize({ width: drawn.offsetWidth, height: drawn.offsetHeight });
    }
  });

  return (
    <button
      ref={button}
      type="button"
      aria-label="Take the passage"
      data-take
      {...press}
      onClick={onTake}
      style={fitButton(at, size)}
      className={at.above ? `${TAKE} -translate-y-full` : TAKE}
    >
      <span>Take</span>
      <span className="text-k-muted">y</span>
      {label !== "" && <span className="min-w-0 max-w-64 truncate text-k-muted">{label}</span>}
    </button>
  );
}
