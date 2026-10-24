import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { VideoDetails } from "@/components/video-details";
import { VideoShield } from "@/components/video-shield";
import { VideoTakes } from "@/components/video-takes";
import { type TranscriptHandle, VideoTranscript } from "@/components/video-transcript";
import { fetchNote } from "@/lib/api";
import type { Passage } from "@/lib/highlight";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { readField } from "@/lib/note-frontmatter";
import { noteName } from "@/lib/note-path";
import { LABEL } from "@/lib/overlay-styles";
import { useVideoPlayer } from "@/lib/use-video-player";
import { noteVideos, PLAYER, playerUrl, watchedAt } from "@/lib/video";
import { noteChapters, watchUrl } from "@/lib/video-notes";
import { beginLeader, paneOpener } from "@/lib/which-key";

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
  /** Whether the recent notes list of the take toast includes archived notes. */
  archive: boolean;
  /** Write a take from the transcript into this note (the route's guarded `takeHighlight`). Answers the anchor id, or null. */
  onTake: (passage: Passage) => Promise<string | null>;
  /** Raised by a time button in the note: seek to `seconds`. A counter in `signal`, as `playSignal` is. */
  seekSignal?: { seconds: number; signal: number };
  /** A click or tap on the shield: tell the layout this pane has the focus (the frame's own click never reaches it). */
  onFocus?: () => void;
}

/** A frontmatter value read as a name: the link brackets and quotes it may carry come off. */
function plain(value: string | undefined): string | undefined {
  return value?.replace(/\[\[|\]\]|["']/g, "").trim() || undefined;
}

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
 */
export function VideoPane({
  note,
  commands,
  focusSignal,
  playSignal,
  onWatched,
  archive,
  onTake,
  seekSignal,
  onFocus,
}: VideoPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const transcript = useRef<TranscriptHandle>(null);
  /** Which of the note's videos is in the frame, by position in the note. */
  const [index, setIndex] = useState(0);
  /** Whether the pane shows the video view: the big player beside the transcript. */
  const [view, setView] = useState(false);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");

  const { data: text, isPending } = useQuery({
    queryKey: ["note", note],
    queryFn: () => fetchNote(note),
  });

  const videos = useMemo(() => (text === undefined ? [] : noteVideos(text)), [text]);
  const chapters = useMemo(() => (text === undefined ? [] : noteChapters(text)), [text]);
  // Clamped rather than reset: a note edited while you watch can lose the link
  // you are three videos past, and landing on the last one beats landing on
  // nothing. `index` is only ever moved by `n` and `p`.
  const id = videos[Math.min(index, videos.length - 1)];
  const { at, running, second, detail, report, seek, togglePlayer } = useVideoPlayer({
    id,
    frame,
    onWatched,
    playSignal,
    seekSignal,
  });

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
  }
  const source = id === undefined ? null : (opened.current?.url ?? null);

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

  /** A seek from a control in the pane. The cursor goes back to the pane, as a tap on the count does. */
  function seekAndFocus(seconds: number) {
    seek(seconds);
    panel.current?.focus();
  }

  /** Move to another of the note's videos, wrapping at either end. */
  function step(by: number) {
    report();
    setIndex((was) => (was + by) % Math.max(videos.length, 1));
  }

  // The leader block the image pane, the exam pane and the todo pane each carry
  // their own copy of. Nothing else is bound: there is nothing here to operate,
  // the player owning every key that reaches it.
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    // A modifier holds itself down before the key it is held for arrives, and
    // a pending sequence that read it as a key would drop the sequence there.
    if (heldModifier(key)) return;

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
      if (beginLeader(paneOpener(commands))) {
        event.preventDefault();
        return;
      }
      setPending(key);
      event.preventDefault();
      return;
    }

    // The video's own keys, bare letters for the same reason `n` and `p` are.
    // `j` and `l` seek from the second the pane holds, not from the player,
    // which would answer a little late. `y` is only the view's, and a Take
    // answering no (no selection) leaves the key to the browser.
    if (key === "k" && source !== null) {
      event.preventDefault();
      togglePlayer();
      return;
    }
    if ((key === "j" || key === "l") && source !== null) {
      event.preventDefault();
      seek(second.current + (key === "l" ? 10 : -10));
      return;
    }
    if (key === "y" && view && transcript.current?.take()) event.preventDefault();

    // The note's other videos, a lecture at a time. Bare letters because there
    // is nothing else in this pane to type, and the same pair the todo pane
    // steps its list with.
    if (key === "n" || key === "p") {
      event.preventDefault();
      step(key === "n" ? 1 : videos.length - 1);
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
      className="@container/pane flex h-full flex-col bg-k-bg font-sans outline-none"
    >
      <header className="flex items-center gap-3 border-b border-k-rule px-3 py-1">
        <span className={`shrink-0 ${LABEL}`}>VIDEO</span>
        <span
          className="min-w-0 flex-1 truncate font-mono text-k-13 text-k-ink"
          title={id === undefined ? undefined : `${PLAYER}/watch?v=${id}`}
        >
          {id === undefined ? "" : `youtube.com/watch?v=${id}`}
        </span>
        {videos.length > 1 && (
          // Only once there is something to step through. A note with one video
          // saying "1/1" is a number that answers a question nobody asked.
          // A button because a phone has no `n`: a tap is the next video, and
          // the wrap is what reaches the ones behind. The cursor goes back to
          // the pane, or the leader's space would press the button again.
          // Out of the tab order for the same reason: the keyboard has `n`.
          <button
            type="button"
            tabIndex={-1}
            aria-label="next video"
            onClick={() => {
              step(1);
              panel.current?.focus();
            }}
            className={`shrink-0 cursor-pointer pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${LABEL}`}
          >
            {Math.min(index, videos.length - 1) + 1}/{videos.length}
          </button>
        )}
        {id !== undefined && (
          <>
            <button
              type="button"
              aria-pressed={view}
              onClick={() => {
                setView((was) => !was);
                panel.current?.focus();
              }}
              className="ml-auto shrink-0 cursor-pointer whitespace-nowrap font-sans text-k-12 text-k-link hover:text-k-accent pointer-coarse:min-h-11"
            >
              Video view
            </button>
            <a
              href={watchUrl(id, at)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center whitespace-nowrap font-sans text-k-12 text-k-link hover:text-k-accent pointer-coarse:min-h-11"
            >
              Open on YouTube
            </a>
          </>
        )}
      </header>

      {/*
        The same path to the frame in both modes, so the view only changes classes
        and the frame keeps its place: the transcript is a sibling after the player
        column, not a wrapper around it.
      */}
      <div
        className={
          view
            ? "flex min-h-0 flex-1 flex-col overflow-y-auto [container-type:size] @3xl/pane:flex-row @3xl/pane:overflow-hidden"
            : "flex min-h-0 flex-1 flex-col overflow-y-auto [container-type:size]"
        }
      >
        <div
          className={
            view
              ? "flex flex-col gap-3 p-3 @3xl/pane:w-3/5 @3xl/pane:overflow-y-auto"
              : "flex flex-col gap-3 p-2"
          }
        >
          {source === null ? (
            <p role="status" className="px-1 py-2 text-k-13 text-k-muted">
              {isPending ? "Reading the note" : "No video linked in this note"}
            </p>
          ) : (
            // Capped to the pane's height as well as its width: the body is a size
            // container, so 70% of its height is the most a player may take, and
            // the rest is left for the title, the chapters and the line under them.
            <div className="relative mx-auto aspect-video w-[min(100%,calc(70cqh*16/9))] shrink-0">
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
                // Autoplay is handed over for the shield: a tap on it is a script
                // call into a cross-origin frame, which the frame honours only when
                // it is delegated autoplay. The URL carries no `autoplay=1`, so
                // nothing starts on its own. Nothing else is granted: no camera, no
                // clipboard.
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
              <VideoShield
                running={running}
                onPress={() => {
                  togglePlayer();
                  panel.current?.focus();
                  onFocus?.();
                }}
              />
            </div>
          )}
          {source !== null && id !== undefined && (
            <>
              <VideoDetails
                title={detail?.title ?? noteName(note)}
                speaker={
                  plain(text === undefined ? undefined : readField(text, "speaker")) ??
                  detail?.author
                }
                chapters={chapters}
                at={at}
                onSeek={seekAndFocus}
              />
              <p className="px-3 font-sans text-k-12 text-k-muted">
                Your place is kept in the note's <code className="font-mono">watching</code> field
                when you pause.
              </p>
            </>
          )}
          {view && id !== undefined && text !== undefined && (
            <div className="flex flex-col gap-1">
              <h3 className={`px-3 ${LABEL}`}>Taken from this video</h3>
              <VideoTakes text={text} id={id} onSeek={seekAndFocus} />
            </div>
          )}
        </div>
        {view && id !== undefined && text !== undefined && (
          <div className="flex min-h-0 flex-col border-t border-k-rule @3xl/pane:w-2/5 @3xl/pane:border-t-0 @3xl/pane:border-l">
            <VideoTranscript
              key={`${note}:${id}`}
              note={note}
              id={id}
              text={text}
              second={at}
              archive={archive}
              onTake={onTake}
              onSeek={seekAndFocus}
              handle={transcript}
            />
          </div>
        )}
      </div>
    </section>
  );
}
