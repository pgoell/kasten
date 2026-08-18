import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchNote } from "@/lib/api";
import { type EditorCommands, leaderAction, leaderPrefix } from "@/lib/key-bindings";
import { noteName } from "@/lib/note-path";
import { LABEL } from "@/lib/overlay-styles";
import { noteVideos, PLAYER, playerUrl, watchedAt } from "@/lib/video";

interface VideoPaneProps {
  /** The note holding the link. The pane reads it and never writes to it. */
  note: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /**
   * Raised when `<leader>v` was pressed in the note this plays for.
   *
   * A counter and not a boolean, the way `focusSignal` is one: what the key
   * means is "again", and a boolean has nothing to say the second time.
   */
  playSignal?: number;
  /**
   * Called with where the player got to, whenever it stops.
   *
   * The pane cannot write it: the note is somebody's open buffer and this pane
   * is not it. The route takes the number from here and puts it where a note
   * that is open can take it without losing what you have typed.
   */
  onWatched: (id: string, seconds: number) => void;
}

/**
 * What the player reports while it is playing or about to be.
 *
 * YouTube's own numbering: 1 is playing and 3 is buffering, which is a video on
 * its way to playing and has to read as playing or the next press starts it
 * again instead of stopping it.
 */
const RUNNING = new Set([1, 3]);

/**
 * The video a note is about, playing beside the note.
 *
 * The point of the pane is that it is a pane: the player keeps its place while
 * the note scrolls under your typing, which an embed drawn into the note itself
 * cannot do. Everything that makes that work is the layout's already,
 * `<leader>l` to reach it and `<leader>q` to put it away.
 *
 * The note is the source of truth and this never writes to it, the way the exam
 * pane reads its note. The read shares the editor's own query, so opening the
 * player beside a note already on screen fetches nothing.
 *
 * ponytail: a click into the player takes the browser's focus without the
 * layout hearing about it, so the blue border stays on the note and keys go to
 * YouTube until you click back. A cross-origin frame tells its parent nothing,
 * and the window-blur trick that guesses it is more machinery than a wrong
 * border is worth. `<leader>h` still works because the pane's own focus signal
 * puts the cursor on this element rather than in the frame.
 */
export function VideoPane({ note, commands, focusSignal, playSignal, onWatched }: VideoPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  /**
   * Whether the player is running, as the player last reported it.
   *
   * A ref and not state: nothing on the screen shows it, and the only reader is
   * the key, which wants the value at the moment it is pressed rather than a
   * render behind. It is also what keeps the toggle honest when the player is
   * driven by a click instead, the report arriving either way.
   */
  const running = useRef(false);
  /** Where the player last said it had got to, in seconds. */
  const second = useRef(0);
  /** Which of the note's videos is in the frame, by position in the note. */
  const [at, setAt] = useState(0);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");

  const { data: text, isPending } = useQuery({
    queryKey: ["note", note],
    queryFn: () => fetchNote(note),
  });

  const videos = useMemo(() => (text === undefined ? [] : noteVideos(text)), [text]);
  // Clamped rather than reset: a note edited while you watch can lose the link
  // you are three videos past, and landing on the last one beats landing on
  // nothing. `at` is only ever moved by `n` and `p`.
  const id = videos[Math.min(at, videos.length - 1)];

  /**
   * The URL the frame was given, held rather than recomputed.
   *
   * It has to be held. The position is written back into the note, so the note
   * changes while you watch, and a URL derived from the note on every render
   * would carry a new `start=` each time and remount the frame under you. The
   * position is a place to open at, read once, and the player owns where it is
   * after that.
   */
  const opened = useRef<{ id: string; url: string }>(null);
  if (id !== undefined && text !== undefined && opened.current?.id !== id) {
    opened.current = { id, url: playerUrl(id, watchedAt(text, id)) };
    // The new frame has played none of it yet, and reporting the old video's
    // second against the new video's id is the one way this could write a
    // position into the wrong entry.
    second.current = 0;
    running.current = false;
  }
  const source = id === undefined ? null : (opened.current?.url ?? null);

  /** Say where the player got to, which is the note's to keep. */
  const report = useCallback(() => {
    if (id !== undefined && second.current > 0) onWatched(id, second.current);
  }, [id, onWatched]);

  // On the way out as well as on every stop: closing the pane is the other way
  // a session ends, and the position would otherwise be the one from the last
  // pause rather than where you actually left off.
  useEffect(() => report, [report]);

  // A freshly focused pane is handed a raised signal and takes the cursor, the
  // way the image pane and the exam pane do. It has to: the pane holds no
  // CodeMirror, so without this the keys would keep going to whichever pane the
  // browser last left the cursor in.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  /**
   * Listen to the player, which is the only way to know what it is doing.
   *
   * A cross-origin frame answers no question asked of it directly, so the
   * arrangement is the other way round: `postMessage` a subscription once the
   * frame is up and it streams its state back. Without this the toggle would
   * have to guess, and a video paused by a click would then need two presses.
   */
  useEffect(() => {
    function heard(event: MessageEvent) {
      if (event.origin !== PLAYER || typeof event.data !== "string") return;

      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch (_malformed: unknown) {
        // Named and typed rather than a bare `catch`, which this repo does not
        // take: the error handled here is a string from the player's origin
        // that is not JSON, and ignoring the message is the whole handling.
        return;
      }

      const info = (message as { info?: { playerState?: unknown; currentTime?: unknown } }).info;
      // Every delivery carries the time and only some carry the state, so the
      // two are read apart. The time is what a stop is reported with, so it has
      // to be the one from before the stop rather than a zero the player sends
      // on its way somewhere else.
      if (typeof info?.currentTime === "number" && info.currentTime > 0) {
        second.current = info.currentTime;
      }
      if (typeof info?.playerState !== "number") return;

      const was = running.current;
      running.current = RUNNING.has(info.playerState);
      // The edge and not the state: a player streams its state while it plays,
      // and reporting on each one would restart the wait forever and never
      // write. Stopping is the moment worth writing, and it happens once.
      if (was && !running.current) report();
    }

    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [report]);

  // The key, sent as the command the player answers to. Nothing happens before
  // the frame is up, which is the render where `source` is still null.
  useEffect(() => {
    if (!playSignal) return;
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({
        event: "command",
        func: running.current ? "pauseVideo" : "playVideo",
        args: [],
      }),
      PLAYER,
    );
  }, [playSignal]);

  // The leader block the image pane, the exam pane and the todo pane each carry
  // their own copy of. Nothing else is bound: there is nothing here to operate,
  // the player owning every key that reaches it.
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      // A leader key can be more than one letter, so a sequence that still
      // prefixes one waits for the rest instead of being dropped.
      setPending(!run && leaderPrefix(wanted) ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (key === " ") {
      setPending(key);
      event.preventDefault();
      return;
    }

    // The note's other videos, a lecture at a time. Bare letters because there
    // is nothing else in this pane to type, and the same pair the todo pane
    // steps its list with.
    if (key === "n" || key === "p") {
      event.preventDefault();
      report();
      setAt((was) => (was + (key === "n" ? 1 : videos.length - 1)) % Math.max(videos.length, 1));
    }
  }

  return (
    <section
      ref={panel}
      data-video-pane
      // Focusable but out of the tab order, the way every other pane holds the
      // cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="video"
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={`shrink-0 ${LABEL}`}>video</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg" title={note}>
          {noteName(note)}
        </span>
        {videos.length > 1 && (
          // Only once there is something to step through. A note with one video
          // saying "1/1" is a number that answers a question nobody asked.
          <span className={`shrink-0 ${LABEL}`}>
            {Math.min(at, videos.length - 1) + 1}/{videos.length}
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
        {source === null ? (
          <p role="status" className="text-[13px] text-one-muted">
            {isPending ? "Reading the note" : "No video linked in this note"}
          </p>
        ) : (
          <iframe
            ref={frame}
            // Keyed on the URL so a note that changes which video it links gets
            // a new frame rather than a stale player told to load another one.
            key={source}
            src={source}
            title="video"
            // The subscription the effect above listens for. It goes on load
            // rather than on mount: a frame that has not finished loading has a
            // `contentWindow` that drops what it is sent.
            onLoad={() =>
              frame.current?.contentWindow?.postMessage(
                JSON.stringify({ event: "listening", channel: "widget" }),
                PLAYER,
              )
            }
            // Fullscreen is the one thing worth handing over: a talk followed
            // properly is watched full width and paused back to the notes.
            // Nothing else is granted, so the frame gets no camera, no clipboard
            // and no autoplay it did not have to be told to start.
            allow="fullscreen; picture-in-picture"
            allowFullScreen
            // 16:9, which is what the player wants and what stops the frame
            // stretching to the pane's height on a wide split.
            className="aspect-video max-h-full w-full border-0"
          />
        )}
      </div>
    </section>
  );
}
