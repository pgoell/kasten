import { LABEL } from "@/lib/overlay-styles";

interface GraphTouchRowProps {
  /** The zoom as a whole percent, or null before the first. */
  zoom: number | null;
  onFit: () => void;
  /** Reach one link further out or in; absent on the whole vault, which has no centre. */
  onDeeper?: (by: 1 | -1) => void;
}

/** The graph's keys that are not the filter, for a screen with no keys, and the zoom. */
export function GraphTouchRow({ zoom, onFit, onDeeper }: GraphTouchRowProps) {
  return (
    <nav aria-label="graph moves" className={`flex border-b border-k-rule px-1 ${LABEL}`}>
      <button type="button" tabIndex={-1} onClick={onFit} className="min-h-11 flex-1 uppercase">
        fit
      </button>
      {/* In the row, not over the canvas, so it hides no note. */}
      {zoom !== null && (
        <output aria-label="zoom" className="flex min-h-11 items-center px-3 tabular-nums">
          {zoom}%
        </output>
      )}
      {onDeeper && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label="one link nearer"
            onClick={() => onDeeper(-1)}
            className="min-h-11 flex-1 uppercase"
          >
            depth -
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="one link further"
            onClick={() => onDeeper(1)}
            className="min-h-11 flex-1 uppercase"
          >
            depth +
          </button>
        </>
      )}
    </nav>
  );
}
