import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { focusedPane, type Layout, tabPanes } from "@/lib/panes";
import { namedVideo, nonEmpty, PLAYER } from "@/lib/video/video";
import {
  applyVideoSettings,
  keepVideoSettings,
  keptVolume,
  learnVideoSettings,
  readVideoSettings,
} from "@/lib/video/video-settings";

/**
 * What the player reports while playing or about to be. YouTube's 1 is playing and 3 is buffering,
 * a video on its way to playing, so it must count as playing or the next press starts it again.
 */
const RUNNING = new Set([1, 3]);

/** One delivery from the player. Each one carries some of these, not all. */
interface Delivery {
  info?: {
    playerState?: unknown;
    currentTime?: unknown;
    volume?: unknown;
    muted?: unknown;
    videoData?: { video_id?: unknown; title?: unknown; author?: unknown } | null;
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
  /** Whether the player is muted, as state, for the Mute button. */
  muted: boolean;
  /** Turn the volume up or down by `by`, within 0 to 100; unmutes, as YouTube does. */
  volumeBy: (by: number) => void;
  /** Mute, or unmute at the volume from before. */
  toggleMute: () => void;
}

/** A command the player answers to, posted to the frame. Nothing is sent before the frame is up. */
function command(frame: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), PLAYER);
}

/** Whether `event` is a string from the player in `frame`. */
function fromPlayer(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
): event is MessageEvent<string> {
  if (event.origin !== PLAYER || typeof event.data !== "string") return false;
  // A message from another frame on the page is not this player's. A null
  // source is let through, since the tests' synthetic MessageEvents carry none.
  return event.source === null || event.source === frame?.contentWindow;
}

/** A player message read as JSON, or undefined where it is none. */
function parsed(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch (_malformed: unknown) {
    // Named and typed rather than a bare `catch`, which this repo does not
    // take: the error handled here is a string from the player's origin
    // that is not JSON, and ignoring the message is the whole handling.
    return undefined;
  }
}

/**
 * The player in a video pane: position, running state, name, and the commands sent to it. A cross-origin
 * frame answers no questions, so it streams its state after one `postMessage` subscription, or the toggle would guess.
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
   * Whether the player is running, for the key. The key reads this ref at press time, not a render behind
   * the state, and it is set beside the state so the two cannot disagree.
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
   * Set when the player reports it has ended, which writes the start back into the note.
   * Until it runs again nothing is written for this video, or closing the pane would restore its duration over that start.
   */
  const ended = useRef(false);
  /** The video the player last named, and whether it is another one than `id`. */
  const named = useRef<string | undefined>(undefined);
  const elsewhere = useRef(false);
  /** The player's volume as it last said or was told, for a browser that keeps none. */
  const level = useRef(100);
  // Read at mount: a kept mute is put back on ready, and the button says so from the start.
  const mutedNow = useRef(readVideoSettings().muted === true);
  const [muted, setMuted] = useState(mutedNow.current);

  // The new frame has played none of it yet, and reporting the old video's
  // second against the new video's id is the one way this could write a
  // position into the wrong entry.
  if (id !== about.current) {
    about.current = id;
    second.current = 0;
    runningNow.current = false;
    ended.current = false;
    named.current = undefined;
    elsewhere.current = false;
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

  // Nothing is reported while the player is on another video: its position is
  // that video's, and the note's entry for this one would take it.
  const report = useCallback(() => {
    if (id !== undefined && second.current > 0 && !ended.current && !elsewhere.current) {
      onWatchedRef.current(id, second.current);
    }
  }, [id]);

  useEffect(() => {
    function heard(event: MessageEvent) {
      if (!fromPlayer(event, frame.current)) return;

      const message = parsed(event.data);
      if (message === undefined) return;

      learnVideoSettings(message);
      if ((message as { event?: unknown }).event === "onReady") {
        applyVideoSettings((func, args) => command(frame.current, func, args));
      }

      const info = (message as Delivery).info;
      hearSound(info);
      // Read first: a delivery that names another video carries that video's
      // time and state, and none of it is this video's to keep.
      const which = namedVideo(named.current, info?.videoData, id);
      named.current = which.named;
      elsewhere.current = which.elsewhere;
      hearPlace(info);
      if (typeof info?.playerState === "number") hearState(info.playerState);
    }

    function hearSound(info: Delivery["info"]) {
      level.current = keptVolume(info?.volume) ?? level.current;
      if (typeof info?.muted !== "boolean") return;
      mutedNow.current = info.muted;
      setMuted(info.muted);
    }

    function hearPlace(info: Delivery["info"]) {
      // Every delivery carries the time and only some carry the state, so the
      // two are read apart. The time is what a stop is reported with, so it has
      // to be the one from before the stop rather than a zero the player sends
      // on its way somewhere else.
      if (!elsewhere.current && typeof info?.currentTime === "number" && info.currentTime > 0) {
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
    }

    function hearState(state: number) {
      const was = runningNow.current;
      runningNow.current = RUNNING.has(state);
      setRunning(runningNow.current);
      if (runningNow.current) ended.current = false;
      // An ended video starts from the beginning next time, so its entry goes
      // rather than its end. Written once: the player may say `ended` again.
      if (state === 0 && id !== undefined && !ended.current && !elsewhere.current) {
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
   * Does not play or pause: the player keeps its state. The `true` lets the seek go past what is buffered.
   * The seeked time is set here too, so two presses of `j` add up before the player answers.
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

  // The browser's kept level comes first, so a second pane starts from the last one set in either.
  const volumeBy = useCallback(
    (by: number) => {
      const to = Math.min(
        100,
        Math.max(0, (keptVolume(readVideoSettings().volume) ?? level.current) + by),
      );
      command(frame.current, "setVolume", [to]);
      if (mutedNow.current) command(frame.current, "unMute");
      level.current = to;
      mutedNow.current = false;
      setMuted(false);
      keepVideoSettings({ volume: to, muted: false });
    },
    [frame],
  );

  const toggleMute = useCallback(() => {
    const mute = !mutedNow.current;
    if (mute) {
      command(frame.current, "mute");
    } else {
      command(frame.current, "unMute");
      command(frame.current, "setVolume", [
        keptVolume(readVideoSettings().volume) ?? level.current,
      ]);
    }
    mutedNow.current = mute;
    setMuted(mute);
    keepVideoSettings({ muted: mute });
  }, [frame]);

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
    muted,
    volumeBy,
    toggleMute,
  };
}

/** Whether a pane of the active tab plays `note`'s video, so a time in that note can seek it. */
export function seekTarget(layout: Layout, note: string): boolean {
  return tabPanes(layout).some((each) => each.video === note);
}

/** The seek a time asked for, counted so the same time asked twice seeks twice. */
interface SeekAsk {
  note: string;
  seconds: number;
  id?: string;
  signal: number;
}

/** The next ask after `previous`, one count on. */
export function nextSeek(previous: SeekAsk, note: string, seconds: number, id?: string): SeekAsk {
  return { note, seconds, id, signal: previous.signal + 1 };
}

/**
 * The video pane a `Space v` press plays in, fixed at the press.
 *
 * Read on every render, a pane that became the target after the press would play
 * on the old count, so the target is taken when the count moves and kept.
 */
export function pressTarget(
  previous: { signal: number; target: string | undefined },
  playSignal: number,
  layout: Layout,
): { signal: number; target: string | undefined } {
  if (playSignal === previous.signal) return previous;
  return { signal: playSignal, target: videoTarget(layout) };
}

/**
 * The video pane `Space v` plays in: the focused one, else the one playing the
 * focused note's video, else the first of the tab. Undefined when the tab holds
 * no video pane, so the key has nothing to play.
 */
export function videoTarget(layout: Layout): string | undefined {
  const focused = focusedPane(layout);
  if (focused.video !== undefined) return focused.id;
  const videos = tabPanes(layout).filter((each) => each.video !== undefined);
  return (videos.find((each) => each.video === focused.path) ?? videos[0])?.id;
}

/** Counter, not a flag: each `<leader>v` bumps it, so every press reaches the player. */
export function usePlayAsk(): { playSignal: number; play: () => void } {
  const [playSignal, setPlaySignal] = useState(0);
  const play = useCallback(() => setPlaySignal((count) => count + 1), []);
  return { playSignal, play };
}

export interface VideoAsks {
  /** The play count pane `id` answers: the press's own for the pane fixed at it, else 0. */
  playFor: (id: string) => number;
  /** The seek for the pane playing `note`'s video, undefined for every other pane. */
  seekFor: (note: string) => VideoPlayerOptions["seekSignal"];
  /** Ask the pane playing `note`'s video to seek, or say in the bar that none is open. */
  seek: (note: string, seconds: number, id?: string) => void;
}

/** The play and seek asks over the active tab, held once above every pane. */
export function useVideoAsks(
  layout: Layout,
  playSignal: number,
  onNotice: (notice: string) => void,
): VideoAsks {
  // The target of the press, held from the press on: see `pressTarget`.
  const pressed = useRef<{ signal: number; target: string | undefined }>({
    signal: 0,
    target: undefined,
  });
  pressed.current = pressTarget(pressed.current, playSignal, layout);
  // The layout is read through a ref so the callback the notes hold stays put.
  const [seekAsk, setSeekAsk] = useState<SeekAsk>({ note: "", seconds: 0, signal: 0 });
  const layoutNow = useRef(layout);
  layoutNow.current = layout;
  const seek = useCallback(
    (note: string, seconds: number, id?: string) => {
      if (!seekTarget(layoutNow.current, note)) {
        onNotice("No player is open for this note: Space g v opens it");
        return;
      }
      setSeekAsk((previous) => nextSeek(previous, note, seconds, id));
    },
    [onNotice],
  );
  const target = pressed.current.target;
  return {
    // A press with no video pane on screen raises a number nothing reads.
    playFor: (id) => (id === target ? playSignal : 0),
    seekFor: (note) =>
      seekAsk.note === note
        ? { seconds: seekAsk.seconds, signal: seekAsk.signal, id: seekAsk.id }
        : undefined,
    seek,
  };
}
