import type { TodoState } from "@/lib/todo";

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
 * A state drawn as a box of its own, one look per state, so the states read
 * apart at a glance without the words. Every colour is a token class: the
 * theme sets them, and the box follows the switch between light and dark.
 *
 * Static, so nothing here transitions. A state changing under the finger is
 * drawn by the next render, not by a fade between two boxes.
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
