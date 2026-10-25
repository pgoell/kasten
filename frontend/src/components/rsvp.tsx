import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { trapTab } from "@/lib/focus-trap";
import { isError } from "@/lib/foliate-view";
import { LABEL, PANEL, STATUS } from "@/lib/overlay-styles";
import {
  back,
  chunkEnd,
  clampSetting,
  delay,
  forward,
  LIMITS,
  orp,
  type Place,
  placeAt,
  type RsvpSettings,
  type RsvpSource,
  resume,
  settingsOf,
  type Word,
} from "@/lib/rsvp";
import { fetchRsvp, saveRsvp } from "@/lib/rsvp-api";

/** Where the settings live, one set per device: a phone reads slower than a desk. */
const SETTINGS_KEY = "kasten.rsvp";

/** Blocked or full storage throws a `DOMException` on any touch, which reads as nothing kept. */
function loadSettings(): RsvpSettings {
  try {
    return settingsOf(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"));
  } catch (error) {
    if (error instanceof DOMException || error instanceof SyntaxError) return settingsOf(null);
    throw error;
  }
}

function keepSettings(settings: RsvpSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

/**
 * The sheet over the pane, as the book's contents draw it: the reader sits
 * beside notes you are meant to keep seeing, so it covers one pane and not the
 * window.
 */
const SHEET =
  "absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4 focus:outline-none";

const STEP_BUTTON =
  "inline-flex min-w-6 items-center justify-center text-k-link hover:text-k-accent focus-visible:text-k-accent pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/**
 * One text, one chunk at a time, in one spot: rapid serial visual presentation.
 *
 * One component for every pane that reads, over the pane it was opened in. The
 * pane hands it a source and nothing else, so a note, a page, a pdf and a book
 * play the same way and keep their place the same way, in the backend's
 * `rsvp_places` table, keyed by the file's path.
 */
export function Rsvp({
  source,
  here,
  onClose,
}: {
  source: RsvpSource;
  /** Start from the source's own place, the cursor or the page on screen, rather than resume. */
  here: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [words, setWords] = useState<Word[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  /** A line for the foot of the panel: a save that failed, a copy that landed. */
  const [notice, setNotice] = useState("");

  // The source as it was when the reader opened. The pane makes a new one on
  // every render, and a new one is not a new text.
  const sourceRef = useRef(source);
  // Read by the listener and the cleanup, which are made once.
  const now = useRef({ words, index, playing, settings, onClose });
  useLayoutEffect(() => {
    now.current = { words, index, playing, settings, onClose };
  });
  /** The word last saved, so a press that moved nothing writes nothing. */
  const saved = useRef(-1);

  /**
   * The save waiting while another is in the air, the newest only. Two sent at
   * once can land in either order, and the older landing last would move the
   * place back, so one goes at a time and a place passed over is never sent.
   */
  const waiting = useRef<{ path: string; place: Place } | null>(null);
  const sending = useRef(false);

  const send = useCallback((path: string, place: Place) => {
    sending.current = true;
    saveRsvp(path, place)
      .then(
        () => {},
        (error: unknown) => {
          saved.current = -1;
          setNotice(error instanceof Error ? error.message : "The place was not saved");
        },
      )
      .then(() => {
        sending.current = false;
        const next = waiting.current;
        waiting.current = null;
        if (next !== null) send(next.path, next.place);
      });
  }, []);

  const save = useCallback(
    (at: number) => {
      const list = now.current.words;
      if (list === null || list.length === 0 || at === saved.current) return;
      saved.current = at;
      const job = { path: sourceRef.current.path, place: placeAt(list, at) };
      if (sending.current) waiting.current = job;
      else send(job.path, job.place);
    },
    [send],
  );

  // The text and the saved place, read once.
  useEffect(() => {
    let open = true;
    opening(sourceRef.current, here, () => open).then(
      ({ list, start, moved }) => {
        if (!open) return;
        now.current.words = list;
        setWords(list);
        setIndex(start);
        // "From here" moves the place, so a run opened later resumes at it.
        if (moved) save(start);
        else saved.current = start;
      },
      (error: unknown) => {
        if (open) setFailed(error instanceof Error ? error.message : "The text could not be read");
      },
    );
    return () => {
      open = false;
    };
  }, [here, save]);

  // Saved on the way out, whichever way out it was: Escape, or the pane going.
  useEffect(() => () => save(now.current.index), [save]);

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  useEffect(() => {
    keepSettings(settings);
  }, [settings]);

  // The next chunk once this one has had its time. At the end the last chunk
  // stays up and the run pauses, which saves it.
  useEffect(() => {
    if (!playing || words === null) return;
    const end = chunkEnd(words, index, settings.chunk);
    const timer = setTimeout(
      () => {
        if (end >= words.length) {
          setPlaying(false);
          save(index);
        } else setIndex(end);
      },
      delay(words, index, end, settings),
    );
    return () => clearTimeout(timer);
  }, [playing, words, index, settings, save]);

  const toggle = useCallback(() => {
    if (now.current.playing) save(now.current.index);
    setPlaying(!now.current.playing);
  }, [save]);

  const change = useCallback((name: keyof RsvpSettings, by: number) => {
    setSettings((previous) => ({
      ...previous,
      [name]: clampSetting(name, previous[name] + by * LIMITS[name].step),
    }));
  }, []);

  /** The two copies between this place and the book's `reading:`. */
  const copy = useCallback(
    async (direction: "to" | "from") => {
      const book = sourceRef.current.book;
      const list = now.current.words;
      if (book === undefined || list === null) return;
      const word = list[now.current.index];
      try {
        if (direction === "to") {
          if (word === undefined) return;
          await book.toReading(word);
          setNotice("reading: moved here");
          return;
        }
        const at = await book.fromReading(list);
        setIndex(at);
        save(at);
        setNotice("Moved to reading:");
      } catch (error) {
        // foliate throws its own realm's errors, which `instanceof Error` misses.
        if (!isError(error)) throw error;
        setNotice(`The copy failed: ${(error as Error).message}`);
      }
    },
    [save],
  );

  // A native listener on the dialog, and every key stopped there. The panes
  // under it listen natively too (the book's wrapper, foliate's sections), and
  // a listener below them is the one place that hears a key before they do.
  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    function step(move: typeof back, unit: "sentence" | "paragraph") {
      const list = now.current.words;
      if (list !== null) setIndex(move(list, now.current.index, unit));
    }
    const actions: Record<string, () => void> = {
      Escape: () => now.current.onClose(),
      " ": toggle,
      h: () => step(back, "sentence"),
      l: () => step(forward, "sentence"),
      H: () => step(back, "paragraph"),
      L: () => step(forward, "paragraph"),
      j: () => change("wpm", -1),
      k: () => change("wpm", 1),
      // `r` for `reading:`, and shifted for the other way, as `H` is `h` reached harder.
      r: () => void copy("to"),
      R: () => void copy("from"),
    };
    function onKeyDown(event: KeyboardEvent) {
      event.stopPropagation();
      if (element !== null && trapTab(event, element)) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const action = actions[event.key];
      if (action === undefined) return;
      event.preventDefault();
      action();
    }
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [toggle, change, copy]);

  /** The word under the pointer on the progress bar. */
  function wordAt(clientX: number): number | null {
    const box = bar.current?.getBoundingClientRect();
    if (words === null || words.length === 0 || box === undefined || box.width === 0) return null;
    const share = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    return Math.round(share * (words.length - 1));
  }
  const dragging = useRef(false);

  const total = words?.length ?? 0;
  const share = total > 1 ? index / (total - 1) : 0;
  // The pauses left out, so it errs short.
  const minutes = Math.ceil((total - index) / settings.wpm);

  const steppers: { name: keyof RsvpSettings; label: string }[] = [
    { name: "wpm", label: "wpm" },
    { name: "chunk", label: "words" },
    { name: "size", label: "size" },
    { name: "pause", label: "pause" },
  ];

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard's way out, heard by the native listener above, which React's `onKeyDown` would hear only after the panes under it.
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label="RSVP"
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={SHEET}
    >
      <div className={`${PANEL} w-full max-w-[48rem] max-h-full`}>
        <div className="flex items-center gap-3 border-b border-k-rule px-3 py-2">
          <span className={LABEL}>rsvp</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-k-ink" title={source.path}>
            {source.path}
          </span>
          <span className="shrink-0 text-[11px] text-k-muted tabular-nums">
            {words === null ? "" : `${index + 1} / ${total}, ${minutes} min left`}
          </span>
        </div>

        <div className="relative flex min-h-[8rem] items-center overflow-hidden px-3 py-8">
          {/* The ticks above and below mark the fixed letter's column, which is
              where the eye stays while the words change around it. */}
          <span aria-hidden className="absolute top-3 left-1/2 h-3 w-px bg-k-rule" />
          <span aria-hidden className="absolute bottom-3 left-1/2 h-3 w-px bg-k-rule" />
          <Stage failed={failed} words={words} index={index} settings={settings} />
        </div>

        <div
          ref={bar}
          role="slider"
          aria-label="Place in the text"
          aria-valuemin={1}
          aria-valuemax={Math.max(total, 1)}
          aria-valuenow={index + 1}
          tabIndex={-1}
          onPointerDown={(event) => {
            const at = wordAt(event.clientX);
            if (at === null) return;
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setIndex(at);
          }}
          onPointerMove={(event) => {
            if (!dragging.current) return;
            const at = wordAt(event.clientX);
            if (at !== null) setIndex(at);
          }}
          onPointerUp={(event) => {
            if (!dragging.current) return;
            dragging.current = false;
            const at = wordAt(event.clientX);
            if (at === null) return;
            setIndex(at);
            save(at);
          }}
          // Tall enough to hit, the line itself thin in the middle of it.
          className="mx-3 flex h-6 cursor-pointer touch-none items-center pointer-coarse:h-11"
        >
          <div className="h-1 w-full rounded bg-k-surface">
            <div className="h-1 rounded bg-k-accent" style={{ width: `${share * 100}%` }} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1 text-[12px] text-k-muted">
          <button
            type="button"
            onClick={() => {
              toggle();
              dialog.current?.focus();
            }}
            className={`${STEP_BUTTON} px-1`}
          >
            {playing ? "Pause" : "Play"}
          </button>
          {steppers.map(({ name, label }) => (
            <span key={name} className="inline-flex items-center gap-1">
              <button
                type="button"
                aria-label={`Less ${label}`}
                onClick={() => {
                  change(name, -1);
                  dialog.current?.focus();
                }}
                className={STEP_BUTTON}
              >
                {"−"}
              </button>
              <span className="tabular-nums text-k-ink">{settings[name]}</span>
              <button
                type="button"
                aria-label={`More ${label}`}
                onClick={() => {
                  change(name, 1);
                  dialog.current?.focus();
                }}
                className={STEP_BUTTON}
              >
                +
              </button>
              <span>{label}</span>
            </span>
          ))}
        </div>

        <output className={STATUS}>
          {notice ||
            `Space plays, h l a sentence, H L a paragraph, j k the speed${
              source.book ? ", r writes reading:, R reads it" : ""
            }, Esc closes`}
        </output>
      </div>
    </div>
  );
}

/**
 * The text and the saved place, and where the run starts: from the source's
 * own place when asked for it, else where the last run stopped. A place that
 * cannot be read starts at the top rather than refusing to read: the text is
 * what was asked for.
 */
async function opening(
  source: RsvpSource,
  here: boolean,
  keep: () => boolean,
): Promise<{ list: Word[]; start: number; moved: boolean }> {
  const list = await source.words(keep);
  const place = await fetchRsvp(source.path).then(
    (found) => found,
    () => null,
  );
  const start = here ? await source.here(list) : null;
  return start === null
    ? { list, start: resume(place, list), moved: false }
    : { list, start, moved: true };
}

/** The chunk on screen, its fixed letter in the middle, or why there is none. */
function Stage({
  failed,
  words,
  index,
  settings,
}: {
  failed: string | null;
  words: Word[] | null;
  index: number;
  settings: RsvpSettings;
}) {
  const message =
    failed ??
    (words === null ? "Reading the text…" : words.length === 0 ? "There are no words here" : null);
  if (message !== null || words === null) {
    return <p className="w-full text-center text-[13px] text-k-muted">{message}</p>;
  }

  const shown = words.slice(index, chunkEnd(words, index, settings.chunk));
  const head = shown[0]?.text ?? "";
  const letters = Array.from(head);
  const fixed = orp(head);
  const rest = [letters.slice(fixed + 1).join(""), ...shown.slice(1).map((word) => word.text)];
  return (
    <output
      aria-live="off"
      style={{ fontSize: settings.size }}
      // `1fr auto 1fr` keeps the fixed letter in the middle column whatever
      // the words either side of it measure.
      className="grid w-full grid-cols-[1fr_auto_1fr] font-serif text-k-ink leading-tight"
    >
      <span className="overflow-hidden text-right whitespace-pre">
        {letters.slice(0, fixed).join("")}
      </span>
      <span className="text-k-accent">{letters[fixed] ?? ""}</span>
      <span className="overflow-hidden whitespace-pre">{rest.join(" ")}</span>
    </output>
  );
}
