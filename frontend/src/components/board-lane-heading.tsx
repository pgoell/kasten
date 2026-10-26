/** The heading a board draws over its lanes and columns, in the same type. */
export const HEADING = "pt-2 pb-1 text-k-12 tracking-[var(--k-track-label)] text-k-muted uppercase";

interface LaneHeadingProps {
  name: string;
  /** The cards the lane holds in what is shown, which the heading counts. */
  count: number;
  /** Whether the lane is unfolded, which turns the chevron. */
  open: boolean;
  /** A lane with nothing in the shown state: it folds on its own and cannot be opened. */
  locked: boolean;
  coarse: boolean;
  /** Classes for the heading's own place in the grid, such as a span across the columns. */
  span: string;
  onToggle: () => void;
}

/**
 * A lane's heading: a button that folds the lane, with a chevron and the lane's
 * name. The count is drawn from an attribute, not typed as text, so the
 * heading's text stays the lane's name.
 */
export function LaneHeading({
  name,
  count,
  open,
  locked,
  coarse,
  span,
  onToggle,
}: LaneHeadingProps) {
  return (
    <h3 className={`${HEADING} ${span}`}>
      <button
        type="button"
        aria-expanded={open}
        disabled={locked}
        onClick={onToggle}
        // The count is drawn from the attribute, not typed as text, so the heading's text
        // stays the lane's name: a folded lane's count is still there, and the names read alone.
        data-count={count}
        className={`k-row flex w-full items-center gap-1.5 text-left uppercase after:text-k-12 after:text-k-muted after:content-[attr(data-count)] ${coarse ? "min-h-11" : ""}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`size-3 shrink-0 transition-transform duration-[var(--k-hover)] ease-[var(--k-ease-out)] motion-reduce:transition-none motion-reduce:duration-0 ${open ? "rotate-90" : ""}`}
        >
          <path
            d="M6 4l4 4-4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {name}
      </button>
    </h3>
  );
}
