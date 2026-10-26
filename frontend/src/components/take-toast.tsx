import { useEffect, useState } from "react";
import { noteName } from "@/lib/note-path";
import { useRecentNotes } from "@/lib/use-recent-notes";

/** How long the toast stays up before it starts to fade. */
const SHOWN_MS = 5000;

/** The fade itself: `--k-hover`, the same as the transition on the class below. */
const FADE_MS = 150;

/** The passage's first words, which is all the toast has room for. */
const WORDS = 200;

interface TakeToastProps {
  /** The line above the passage: what happened to it. */
  title: string;
  /** The taken passage, shown cut to two lines. */
  passage: string;
  /** Where the passage came from: its heading, or the page's own name. */
  source: string;
  /** Whether the recent notes list includes archived notes, as the home screen's does. */
  archive: boolean;
  /** Set when the take can be taken back. Absent where it cannot, so no button shows. */
  onUndo?: () => void;
  /** Put the passage into the note picked from the list. Absent where there is no passage to put. */
  onPut?: (path: string) => void;
  /** Called once the toast has faded, so the owner can drop it. Keep it stable. */
  onDone: () => void;
  /** Set when the passage sits low in the frame, so the toast goes to the top and leaves it in sight (#885). */
  top?: boolean;
}

/**
 * The note at the foot of a page pane that says what a take did, and offers to
 * undo it or to put the passage into a note of the reader's choosing.
 *
 * It fades on its own after a few seconds, but not while the pointer is on it
 * or its list of notes is open, since a reader who is reading it should not
 * lose it under them.
 */
export function TakeToast({
  title,
  passage,
  source,
  archive,
  onUndo,
  onPut,
  onDone,
  top,
}: TakeToastProps) {
  const [hovered, setHovered] = useState(false);
  const [listing, setListing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const paused = hovered || listing;

  useEffect(() => {
    if (paused || leaving) return;
    const timer = setTimeout(() => setLeaving(true), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [paused, leaving]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(onDone, FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving, onDone]);

  // The frame less its two margins, so a short pane keeps the toast inside it and
  // the list scrolls instead of growing past the top (#887).
  return (
    <div
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className={`absolute inset-x-3 ${top ? "top-3" : "bottom-3"} z-10 sm:max-w-md max-h-[calc(100%-1.5rem)] flex flex-col gap-1 rounded-[var(--k-radius-6)] border border-k-rule bg-k-paper p-3 shadow-[var(--k-shadow)] transition-opacity duration-(--k-hover) ease-(--k-ease-out) motion-reduce:transition-none ${leaving ? "opacity-0" : "opacity-100"}`}
    >
      <p className="shrink-0 font-sans text-k-13 text-k-muted">{title}</p>
      <p className="line-clamp-2 shrink-0 font-serif text-k-15 text-k-ink">
        {passage.slice(0, WORDS)}
      </p>
      <p className="shrink-0 truncate font-sans text-k-13 text-k-muted">{source}</p>

      <div className="mt-1 flex shrink-0 gap-4 font-sans text-k-13">
        {onPut !== undefined && (
          <button
            type="button"
            aria-expanded={listing}
            onClick={() => setListing((open) => !open)}
            className="text-k-link hover:text-k-accent focus-visible:text-k-accent pointer-coarse:min-h-11"
          >
            Put it in a note
          </button>
        )}
        {onUndo !== undefined && (
          <button
            type="button"
            onClick={onUndo}
            className="text-k-link hover:text-k-accent focus-visible:text-k-accent pointer-coarse:min-h-11"
          >
            Undo
          </button>
        )}
      </div>

      {listing && onPut !== undefined && (
        <RecentNotes
          archive={archive}
          onPick={(path) => {
            setListing(false);
            onPut(path);
          }}
        />
      )}
    </div>
  );
}

/**
 * The notes written lately, to pick one from. Mounted only while the list is
 * open, so the search it reads is asked for then and not while the toast waits.
 */
function RecentNotes({ archive, onPick }: { archive: boolean; onPick: (path: string) => void }) {
  const recent = useRecentNotes(archive);
  if (recent.length === 0) {
    return <p className="font-sans text-k-13 text-k-muted">Nothing written lately.</p>;
  }
  return (
    <ul className="mt-1 flex min-h-0 flex-col overflow-y-auto">
      {recent.map(({ path }) => (
        <li key={path}>
          <button
            type="button"
            title={noteName(path)}
            onClick={() => onPick(path)}
            className="k-row w-full truncate rounded-[var(--k-radius-6)] px-2 py-1 text-left font-sans text-k-15 text-k-ink hover:text-k-accent"
          >
            {noteName(path)}
          </button>
        </li>
      ))}
    </ul>
  );
}
