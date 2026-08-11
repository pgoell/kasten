import { useEffect, useState } from "react";
import { type Clock as ClockReading, readClock } from "@/lib/clock";
import type { SaveStatus } from "@/lib/use-autosave";

const MINUTE_MS = 60_000;

/** How long the refusal flash lasts. The same 400ms `--animate-flash` names. */
const FLASH_MS = 400;

/**
 * The date and time at the foot of the window.
 *
 * The tick is lined up with the wall clock rather than set going a minute at a
 * time from mount, so the minute changes on screen when it changes on the
 * clock instead of up to a minute later. One re-render a minute, not sixty.
 */
function Clock() {
  const [now, setNow] = useState<ClockReading>(() => readClock(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      timer = setTimeout(
        () => {
          setNow(readClock(new Date()));
          tick();
        },
        MINUTE_MS - (Date.now() % MINUTE_MS),
      );
    }

    tick();
    return () => clearTimeout(timer);
  }, []);

  return (
    // Spaced apart rather than punctuated: the gap separates the four readings
    // without spending characters on a bar the eye has to step over.
    <div className="flex items-center gap-3 text-[11px] text-one-muted tabular-nums">
      <span>{now.weekday}</span>
      <time dateTime={now.date}>{now.date}</time>
      <span>CW {now.week}</span>
      <time dateTime={`${now.date}T${now.time}`}>{now.time}</time>
    </div>
  );
}

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving",
  error: "Could not save",
  conflict: "Changed on disk",
};

/**
 * What to do about the two readings that need doing something about.
 *
 * The other three settle themselves, so naming a key under them would be
 * telling the reader to act on a note that is already written.
 */
const SAVE_FIX: Partial<Record<SaveStatus, string>> = {
  error: "Your text is still here. :w or ctrl+s writes it again.",
  conflict: "Somebody else wrote this note. :w keeps your text, :e! takes the vault's.",
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
  /** What the vault answered a failed write with, shown under the reading. */
  reason?: string;
  /**
   * Raised each time a key was refused, which flashes the reading below.
   *
   * The number itself says nothing; that it changed is the whole message. The
   * element is keyed on it, so a fresh one replaces the old and starts the
   * animation again. That is what keeps the timing in CSS and out of here:
   * nothing to schedule, nothing to clear, and no timer left running when the
   * bar unmounts.
   */
  flash?: number;
}

/**
 * The strip along the foot of the window.
 *
 * It runs the full width, under the file tree as well as the editor, and wears
 * the panel's colour with no rule above it so the two read as one surface.
 */
export function StatusBar({ status, reason, flash }: StatusBarProps) {
  // Taken off again once it has played. The class alone would outlive its own
  // animation, and every later mount of this reading, coming back from a tab
  // holding no note, would play it again with nothing refused. `animationend`
  // would say when to stop without a timer, but jsdom fires none, and a flash
  // no test can see is a flash that drifts.
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!flash) return;

    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  return (
    // Three columns rather than two: the outer pair share what the clock does
    // not take, so the reading sits on the middle of the window and does not
    // shift sideways when the save ring appears beside it.
    <footer className="grid h-6 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-one-panel px-3">
      <div />
      <Clock />
      <div className="justify-self-end">
        {status && (
          <span
            key={flash}
            data-testid="save-status"
            // Still one image to a screen reader, text beside the sign or not:
            // the label below says the reading once, and the role keeps the
            // visible copy of it from being read out a second time.
            role="img"
            aria-label={SAVE_LABEL[status]}
            // Three lines on hover, the last of them the way out. A `title` and
            // not a tooltip of our own: this is one string a browser already
            // knows how to show, and it costs nothing to carry.
            title={[SAVE_LABEL[status], reason, SAVE_FIX[status]].filter(Boolean).join("\n")}
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
            {/* Only the two that want the reader. A 16px sign in the corner is
                easy to type straight past, and typing past this one loses the
                text. `aria-hidden`, the label above already saying it. */}
            {SAVE_FIX[status] && (
              <span aria-hidden="true" className="text-[11px] text-one-warn">
                {SAVE_LABEL[status]}
              </span>
            )}
          </span>
        )}
      </div>
    </footer>
  );
}
