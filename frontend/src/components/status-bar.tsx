import type { SaveStatus } from "@/lib/use-autosave";

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving",
  error: "Could not save",
};

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
      className={`${ICON} ${spinning ? "animate-spin text-white" : "text-one-green"}`}
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
      className={`${ICON} text-one-warn`}
    >
      <path d="M12 3.5 21.5 20.5H2.5Z" />
      <path d="M12 10.5v4" />
      <path d="M12 17.6h.01" />
    </svg>
  );
}

interface StatusBarProps {
  /** Absent while no note is open, when there is nothing to say about one. */
  status?: SaveStatus;
}

/**
 * The strip along the foot of the window.
 *
 * It runs the full width, under the file tree as well as the editor, and wears
 * the panel's colour with no rule above it so the two read as one surface.
 */
export function StatusBar({ status }: StatusBarProps) {
  return (
    <footer className="flex h-6 shrink-0 items-center justify-end bg-one-panel px-3">
      {status && (
        <span
          data-testid="save-status"
          role="img"
          aria-label={SAVE_LABEL[status]}
          title={SAVE_LABEL[status]}
        >
          {status === "error" ? <Warning /> : <Spinner spinning={status !== "saved"} />}
        </span>
      )}
    </footer>
  );
}
