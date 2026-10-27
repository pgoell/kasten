import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PLAYER } from "@/lib/video";
import { applyVideoSettings, learnVideoSettings } from "@/lib/video-settings";

/**
 * What the player reports while it is playing or about to be.
 *
 * YouTube's own numbering: 1 is playing and 3 is buffering, which is a video on
 * its way to playing and has to read as playing or the next press starts it
 * again instead of stopping it.
 */
const RUNNING = new Set([1, 3]);

/** One delivery from the player. Each one carries some of these, not all. */
interface Delivery {
  info?: {
    playerState?: unknown;
    currentTime?: unknown;
    videoData?: { title?: unknown; author?: unknown } | null;
  };
}

/** What the player says a video is called and who made it. */
export interface Detail {
  title?: string;
  author?: string;
}

export interface VideoPlayerOptions {
  /** The video in the frame, or undefined while there is none. */
  id: string | undefined;
  frame: RefObject<HTMLIFrameElement | null>;
  /** Called with the id and where the player got to, whenever it stops. */
  onWatched: (id: string, seconds: number) => void;
  /** A counter: each raise plays or pauses the player. */
  playSignal?: number;
  /**
   * A counter: each raise seeks the player to `seconds`. With an `id`, the seek
   * is for that video, and a player on another video leaves it alone.
   */
  seekSignal?: { seconds: number; signal: number; id?: string };
  /**
   * Called for a raise that names another video, which the pane may switch to
   * (it is the pane that knows what the note links).
   */
  onOtherVideo?: (id: string, seconds: number) => void;
}

export interface VideoPlayer {
  /** The second the player is at, as state, so the marks and the transcript follow it. */
  at: number;
  /** Whether the player is running, as state, for the shield's label and the play circle. */
  running: boolean;
  /** Where the player last said it had got to, read at the moment it is asked. */
  second: RefObject<number>;
  /** What the player said the video is called and who made it. */
  detail: Detail | undefined;
  /** Say where the player got to, which is the note's to keep. */
  report: () => void;
  /** Play, or pause when the player is running. */
  togglePlayer: () => void;
  /** Seek to `seconds`, the one way the pane moves the video. */
  seek: (seconds: number) => void;
}

/** A command the player answers to, posted to the frame. Nothing is sent before the frame is up. */
function command(frame: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), PLAYER);
}

/** A string the player sent, or undefined when it sent none or an empty one. */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The player in a video pane: where it is, whether it runs, what it is called,
 * and the commands the pane sends it.
 *
 * A cross-origin frame answers no question asked of it directly, so the
 * arrangement is the other way round: `postMessage` a subscription once the
 * frame is up and it streams its state back. Without this the toggle would have
 * to guess, and a video paused by a click would then need two presses.
 */
export function useVideoPlayer({
  id,
  frame,
  onWatched,
  playSignal,
  seekSignal,
  onOtherVideo,
}: VideoPlayerOptions): VideoPlayer {
  /**
   * Whether the player is running, as the player last reported it, for the key.
   *
   * The state is what the screen shows; this ref is what the key reads, at the
   * moment it is pressed rather than a render behind. It is set in the same
   * place as the state, so the two cannot disagree.
   */
  const runningNow = useRef(false);
  const [running, setRunning] = useState(false);
  /** Where the player last said it had got to, in seconds. */
  const second = useRef(0);
  const [at, setAt] = useState(0);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  /** The video the state above is about, to tell when it has changed. */
  const about = useRef<string | undefined>(undefined);
  /**
   * Set when the player reports it has ended, which writes the start back into
   * the note. Until it runs again nothing is written for this video, or closing
   * the pane would put its duration back over that start.
   */
  const ended = useRef(false);

  // The new frame has played none of it yet, and reporting the old video's
  // second against the new video's id is the one way this could write a
  // position into the wrong entry.
  if (id !== about.current) {
    about.current = id;
    second.current = 0;
    runningNow.current = false;
    ended.current = false;
    setAt(0);
    setRunning(false);
  }

  // Read through a ref, the way `use-book-view.ts` reads its callbacks. The route
  // builds `onWatched` fresh on every render, and a `report` keyed on it would
  // hand the effect below a new cleanup each time, which reports, which writes
  // the note, which renders the route again.
  //
  // Written in a layout effect, which runs in the commit's own task: a stop
  // heard between the commit and the passive effects would otherwise report
  // through the callback before, which holds the note's old path.
  const onWatchedRef = useRef(onWatched);
  useLayoutEffect(() => {
    onWatchedRef.current = onWatched;
  });

  const report = useCallback(() => {
    if (id !== undefined && second.current > 0 && !ended.current) {
      onWatchedRef.current(id, second.current);
    }
  }, [id]);

  useEffect(() => {
    function heard(event: MessageEvent) {
      if (event.origin !== PLAYER || typeof event.data !== "string") return;
      // A message from another frame on the page is not this player's. A null
      // source is let through, since the tests' synthetic MessageEvents carry none.
      if (event.source !== null && event.source !== frame.current?.contentWindow) return;

      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch (_malformed: unknown) {
        // Named and typed rather than a bare `catch`, which this repo does not
        // take: the error handled here is a string from the player's origin
        // that is not JSON, and ignoring the message is the whole handling.
        return;
      }

      learnVideoSettings(message);
      if ((message as { event?: unknown }).event === "onReady") {
        applyVideoSettings((func, args) => command(frame.current, func, args));
      }

      const info = (message as Delivery).info;
      // Every delivery carries the time and only some carry the state, so the
      // two are read apart. The time is what a stop is reported with, so it has
      // to be the one from before the stop rather than a zero the player sends
      // on its way somewhere else.
      if (typeof info?.currentTime === "number" && info.currentTime > 0) {
        second.current = info.currentTime;
        setAt(info.currentTime);
      }
      // The title and the author come in the same deliveries, and are kept by
      // the video they are about, so a `n` to another video shows its own.
      const data = info?.videoData;
      if (id !== undefined && data) {
        const next = { title: nonEmpty(data.title), author: nonEmpty(data.author) };
        setDetails((was) => ({ ...was, [id]: next }));
      }
      if (typeof info?.playerState !== "number") return;

      const was = runningNow.current;
      runningNow.current = RUNNING.has(info.playerState);
      setRunning(runningNow.current);
      if (runningNow.current) ended.current = false;
      // An ended video starts from the beginning next time, so its entry goes
      // rather than its end. Written once: the player may say `ended` again.
      if (info.playerState === 0 && id !== undefined && !ended.current) {
        ended.current = true;
        onWatchedRef.current(id, 0);
      }
      // The edge and not the state: a player streams its state while it plays,
      // and reporting on each one would restart the wait forever and never
      // write. Stopping is the moment worth writing, and it happens once.
      if (was && !runningNow.current) report();
    }

    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [report, id, frame]);

  // Nothing happens before the frame is up, which is the render where the pane
  // has no source yet.
  useEffect(() => {
    if (!playSignal) return;
    command(frame.current, runningNow.current ? "pauseVideo" : "playVideo");
  }, [playSignal, frame]);

  const togglePlayer = useCallback(() => {
    command(frame.current, runningNow.current ? "pauseVideo" : "playVideo");
  }, [frame]);

  /**
   * It does not play or pause: the player keeps its state. The `true` lets the
   * player seek ahead of what it has buffered. A video never played yet may
   * start on a seek, which is YouTube's own rule and not one this hook sets.
   *
   * The second is set here as well as reported, so the marks move at once and
   * two presses of `j` add up before the player has answered the first.
   */
  const seek = useCallback(
    (seconds: number) => {
      const to = Math.max(0, seconds);
      command(frame.current, "seekTo", [to, true]);
      second.current = to;
      setAt(to);
    },
    [frame],
  );

  const seekTo = seekSignal?.seconds;
  const seekCount = seekSignal?.signal;
  const seekId = seekSignal?.id;
  // The signal the pane was mounted with is not a request. The route keeps the
  // last one, so a pane opened again on the same note would otherwise seek at
  // once to a second that is old.
  const seekSeen = useRef(seekCount);
  useEffect(() => {
    if (seekCount === seekSeen.current) return;
    seekSeen.current = seekCount;
    if (!seekCount || seekTo === undefined) return;
    if (seekId !== undefined && seekId !== id) {
      onOtherVideo?.(seekId, seekTo);
      return;
    }
    seek(seekTo);
  }, [seekCount, seekTo, seekId, id, seek, onOtherVideo]);

  return {
    at,
    running,
    second,
    detail: id === undefined ? undefined : details[id],
    report,
    togglePlayer,
    seek,
  };
}
