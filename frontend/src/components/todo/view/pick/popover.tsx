import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

const GAP = 6;
const EDGE = 8;

/** Below the anchor and flush with its right edge, above it where the room runs out. */
function placeBy(anchor: DOMRect, box: DOMRect): { top: number; left: number } {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const below = anchor.bottom + GAP;
  const top = below + box.height > height - EDGE ? anchor.top - GAP - box.height : below;
  const left = Math.min(Math.max(anchor.right - box.width, EDGE), width - box.width - EDGE);
  return { top: Math.max(top, EDGE), left };
}

/**
 * A small panel floating by the element it was opened from. Escape or a press outside closes
 * it; Escape stops there, so the side panel behind it stays open.
 */
export function Popover(props: {
  anchor: HTMLElement | null;
  label: string;
  onClose: () => void;
  /** The popover's own keys; true where a key was taken. */
  onKey?: (event: React.KeyboardEvent) => boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;

  useLayoutEffect(() => {
    const node = box.current;
    if (node === null || props.anchor === null) return;
    setAt(placeBy(props.anchor.getBoundingClientRect(), node.getBoundingClientRect()));
  }, [props.anchor]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) close.current();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, []);

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={props.label}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") props.onClose();
        else if (!props.onKey?.(event)) return;
        event.preventDefault();
      }}
      // Unplaced it is see-through, not hidden: a hidden list could not take the focus.
      style={at ?? { top: 0, left: 0, opacity: 0 }}
      className="fixed z-50 w-[min(360px,calc(100vw-16px))] rounded-xl border border-k-rule bg-k-paper p-2 font-sans shadow-[0_8px_30px_rgb(0_0_0/0.14)]"
    >
      {props.children}
    </div>
  );
}
