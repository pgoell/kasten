import type { SaveStatus } from "@/lib/use-autosave";

// Any smaller and the arrowheads close up into blobs at this stroke width.
const ICON = "size-4 shrink-0";

const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Two arrows chasing each other around a circle.
 *
 * It rests, green, while the note on disk matches the one on screen, and turns
 * white and spins while an edit is still on its way there.
 */
function Spinner({ spinning }: { spinning: boolean }) {
  return (
    <svg
      {...STROKE}
      data-testid="save-spinner"
      aria-hidden="true"
      className={`${ICON} ${spinning ? "animate-spin text-white" : "text-k-ok"}`}
    >
      <path d="M4.8 10.1A7.5 7.5 0 0 1 18.8 8.8" />
      <path d="M19.2 4.9 18.8 8.8 15.5 6.5" />
      <path d="M19.2 13.9A7.5 7.5 0 0 1 5.2 15.2" />
      <path d="M4.8 19.1 5.2 15.2 8.5 17.5" />
    </svg>
  );
}

/** The note is still only on screen, and something has to be done about it. */
function Warning() {
  return (
    <svg
      {...STROKE}
      data-testid="save-error"
      aria-hidden="true"
      className={`${ICON} text-k-danger`}
    >
      <path d="M12 3.5 21.5 20.5H2.5Z" />
      <path d="M12 10.5v4" />
      <path d="M12 17.6h.01" />
    </svg>
  );
}

interface SaveSignProps {
  status: SaveStatus;
  /** The reading in words, which the sign alone does not say. */
  label: string;
  /** Whether the label is drawn beside the sign, for the readings that want the reader. */
  warn: boolean;
  title: string;
  flashing: boolean;
}

/** The sign for the save, the ring or the warning, which hovers as its three lines. */
export function SaveSign({ status, label, warn, title, flashing }: SaveSignProps) {
  return (
    <span
      data-testid="save-status"
      // Still one image to a screen reader, text beside the sign or not:
      // the label below says the reading once, and the role keeps the
      // visible copy of it from being read out a second time.
      role="img"
      aria-label={label}
      // Three lines on hover, the last of them the way out. A `title` and
      // not a tooltip of our own: this is one string a browser already
      // knows how to show, and it costs nothing to carry.
      title={title}
      // Inline by default, and a transform does nothing to an inline box.
      className={`inline-flex items-center gap-1.5 ${flashing ? "animate-flash" : ""}`}
    >
      {/* The conflict wears the warning rather than the ring for the
          reason the failure does: nothing is on its way to the vault,
          and a ring spinning at the reader would say the opposite. */}
      {status === "error" || status === "conflict" ? (
        <Warning />
      ) : (
        <Spinner spinning={status !== "saved"} />
      )}
      {/* Only the ones that want the reader. A 16px sign in the corner is
          easy to type straight past, and typing past this one loses the
          text. `aria-hidden`, the label above already saying it. */}
      {warn && (
        <span aria-hidden="true" className="text-[11px] text-k-danger">
          {label}
        </span>
      )}
    </span>
  );
}
