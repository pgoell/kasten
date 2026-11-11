import type { TodoState } from "@/lib/todo/todo";

/**
 * The order the seven states are listed in, in the legend and on the board's
 * tabs, the same in both so a reader learns it once.
 */
export const STATE_ORDER: TodoState[] = [
  "open",
  "doing",
  "review",
  "waiting",
  "blocked",
  "done",
  "rejected",
];

/**
 * A state drawn as its own box, so states read apart without the words. Colours are token
 * classes, so the box follows light and dark. Static: a state change redraws, not fades.
 */
export function TodoStateBox({ state }: { state: TodoState }) {
  return (
    <svg
      role="img"
      aria-label={state}
      data-state={state}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      className="shrink-0"
    >
      {state === "open" && (
        <rect
          x="2"
          y="2"
          width="12"
          height="12"
          rx="4"
          fill="none"
          strokeWidth="1.5"
          className="stroke-k-muted"
        />
      )}
      {state === "doing" && (
        <>
          {/* The left half only, its corners rounded like the outline's, so the fill stays inside it. */}
          <path d="M8 2 H6 A4 4 0 0 0 2 6 V10 A4 4 0 0 0 6 14 H8 Z" className="fill-k-accent" />
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="4"
            fill="none"
            strokeWidth="1.5"
            className="stroke-k-accent"
          />
        </>
      )}
      {state === "review" && (
        <>
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="4"
            strokeWidth="1.5"
            className="fill-k-accent-wash stroke-k-accent"
          />
          <circle cx="8" cy="8" r="3" className="fill-k-accent" />
        </>
      )}
      {state === "waiting" && (
        <rect
          x="2"
          y="2"
          width="12"
          height="12"
          rx="4"
          fill="none"
          strokeWidth="1.5"
          strokeDasharray="3 2"
          className="stroke-k-warn"
        />
      )}
      {state === "blocked" && (
        <>
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="4"
            fill="none"
            strokeWidth="1.5"
            className="stroke-k-danger"
          />
          <path d="M4.5 8 H11.5" strokeWidth="1.5" className="stroke-k-danger" />
        </>
      )}
      {state === "done" && (
        <>
          <rect x="2" y="2" width="12" height="12" rx="4" className="fill-k-ok" />
          <path
            d="M5 8.5 L7 10.5 L11 6"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-k-paper"
          />
        </>
      )}
      {state === "rejected" && (
        <>
          <rect
            x="2"
            y="2"
            width="12"
            height="12"
            rx="4"
            fill="none"
            strokeWidth="1.5"
            className="stroke-k-muted"
          />
          <path d="M4.5 11.5 L11.5 4.5" strokeWidth="1.5" className="stroke-k-muted" />
        </>
      )}
    </svg>
  );
}
