import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useDumpTake } from "@/components/takes/use-dump-take";
import { readClock } from "@/lib/core/clock";
import { type Story, shareLine, storyOf } from "@/lib/panes/html/html-share";
import { spendActivation } from "@/lib/panes/html/user-activation";
import { fileOf, type PagePassage, pageLink } from "@/lib/takes/html-take";
import {
  type Anchor,
  low,
  placeFor,
  type Rect,
  samePassage,
  selectionOf,
} from "@/lib/takes/page-selection";
import { type PressHandlers, usePressGuard } from "@/lib/takes/take-button";

/** The passage held, and where its button goes, or null where it has no place. */
export interface Held {
  passage: PagePassage;
  at: Anchor | null;
  /** The page's number for the selection, which a take hands back to mark it (#897). */
  seq: number | undefined;
}

/** Where the take button goes for a selection's `rect`, or null where it has no place. */
function placeOf(
  rect: Rect | null,
  frame: Element | null,
  wrapper: HTMLDivElement | null,
  coarse: boolean,
) {
  return rect === null || frame === null || wrapper === null
    ? null
    : placeFor(frame, wrapper, rect, coarse);
}

/** What the pane gets from the take: the held passage to draw, and the calls its keys and listener make. */
export interface HtmlTake {
  /** The passage held, with where its button goes. Drawn from the render. */
  held: Held | null;
  /** The passage held right now, off the ref, for a `y` that arrives before a render. */
  heldNow: () => Held | null;
  /** The press handlers the take button spreads on itself. */
  press: PressHandlers;
  /** The take's toast, which the pane renders inside its wrapper. */
  toast: ReactNode;
  /** Put the held passage into today's dump. Does nothing when no passage is held. */
  take: () => Promise<void>;
  /** Drop what a page change or a reload leaves behind. */
  forget: () => void;
  /** Hold the selection the page reports, or let go of it when the page has none. */
  onSelection: (data: Record<string, unknown>) => void;
  /** Save the story the page's Share later button names, unless the reader has not pressed. */
  onShare: (data: Record<string, unknown>, focused: boolean) => void;
}

/**
 * The passage a reader takes out of an HTML page, from the selection to the dump. The pane owns the
 * button, the frame and the listener, and this hook owns what they hold.
 */
export function useHtmlTake(o: {
  /** Vault-relative path of the page shown. */
  path: string;
  archive: boolean;
  frame: RefObject<HTMLIFrameElement | null>;
  wrapper: RefObject<HTMLDivElement | null>;
  /** Whether the reader is on a touch screen, which puts the button under the words. */
  coarse: boolean;
}): HtmlTake {
  const { path, archive, frame, wrapper, coarse } = o;
  // Read by the listener, which is added once, so it is mirrored in a layout effect.
  const coarseRef = useRef(coarse);
  useLayoutEffect(() => {
    coarseRef.current = coarse;
  });

  /**
   * The passage held for a take, mirrored in a ref: the listener reads it as it is now, and a `y`
   * answered a render late would take the one before.
   */
  const [held, setHeld] = useState<Held | null>(null);
  const heldRef = useRef<Held | null>(null);
  /** Counts held passages and takes, so a refused take knows whether the reader chose since (#899). */
  const picks = useRef(0);
  const hold = useCallback((next: Held | null) => {
    if (next !== null) picks.current += 1;
    heldRef.current = next;
    setHeld(next);
  }, []);

  /**
   * A collapse the page sent during a press on the button, which the press guard holds back. It is
   * answered when the press lands outside the button.
   */
  const lost = useRef(false);
  /** The stories saved to share later, by take id, and their ids in flight, so a second press adds no todo. */
  const shared = useRef(new Map<number, string>());
  const saving = useRef(new Set<string>());
  const { pressing, press } = usePressGuard(() => {
    if (lost.current) {
      lost.current = false;
      hold(null);
    }
  });

  /**
   * The take into today's dump, the toast about it and the Undo. The page is told of the take
   * through the take's `onKept` and of its Undo through `onUnmarked`.
   */
  const dump = useDumpTake({
    archive,
    onMarked: () => {
      // A selection made after `y` is the reader's next one, so only a hold that is still
      // the take's own is cleared (the page's selection message lands while the keep runs).
      if (heldRef.current === null) hold(null);
    },
    onUnmarked: (id) => {
      const anchor = shared.current.get(id);
      if (anchor === undefined) {
        frame.current?.contentWindow?.postMessage({ kasten: "untake", id }, "*");
        return;
      }
      shared.current.delete(id);
      saving.current.delete(anchor);
      frame.current?.contentWindow?.postMessage({ kasten: "unshared", anchor }, "*");
    },
  });
  const dumpForget = dump.forget;

  const forget = useCallback(() => {
    lost.current = false;
    shared.current.clear();
    saving.current.clear();
    hold(null);
    dumpForget();
  }, [hold, dumpForget]);
  // Read against the path last shown, so a pane that starts on the same page
  // keeps what it holds. A new page is a new document, which its script's hello
  // reports as well.
  const shown = useRef(path);
  useEffect(() => {
    if (shown.current === path) return;
    shown.current = path;
    forget();
  }, [forget, path]);

  /**
   * Put the held passage into today's dump. Taken off the ref at once, so a second `y` finds nothing
   * to take. A passage the dump did not keep goes back on hold, unless the reader selected or took
   * another since (#899).
   */
  async function take() {
    // Taken off the ref at once, and the press over with it, so a second `y`
    // finds nothing to take and a collapse after this is answered.
    pressing.current = false;
    lost.current = false;
    const taken = heldRef.current;
    if (taken === null) return;
    heldRef.current = null;
    picks.current += 1;
    const pick = picks.current;

    const { passage } = taken;
    const kept = await dump.take({
      text: passage.text,
      linkIn: (note) => pageLink(path, passage, note),
      source: passage.heading === "" ? fileOf(path) : `${passage.heading}, ${fileOf(path)}`,
      top: low(taken.at),
      onKept: (id) =>
        frame.current?.contentWindow?.postMessage({ kasten: "take", id, seq: taken.seq }, "*"),
    });
    if (!kept && picks.current === pick) hold(taken);
  }
  // The listener is added once, so it reaches the take as it is now through this.
  const takeRef = useRef(take);
  useLayoutEffect(() => {
    takeRef.current = take;
  });
  const takeNow = useCallback(() => takeRef.current(), []);

  /**
   * Save a story to share later as a `#share` todo, linked to its source and place in the paper. A story
   * already saved is not saved twice, and the selection is left as it is.
   */
  async function share(story: Story) {
    if (saving.current.has(story.anchor)) return;
    // Held at once, so a second press while the first is on its way adds nothing.
    saving.current.add(story.anchor);
    const date = readClock(new Date()).date;
    const kept = await dump.take({
      text: story.heading === "" ? fileOf(path) : story.heading,
      linkIn: (note) => pageLink(path, { text: "", ...story }, note),
      line: (note) => shareLine(path, story, note, date),
      source: fileOf(path),
      top: false,
      landed: "Saved to share later",
      onKept: (id) => {
        shared.current.set(id, story.anchor);
        frame.current?.contentWindow?.postMessage({ kasten: "shared", anchor: story.anchor }, "*");
      },
    });
    if (!kept) saving.current.delete(story.anchor);
  }
  const shareRef = useRef(share);
  useLayoutEffect(() => {
    shareRef.current = share;
  });

  /** Let go of the held passage, unless a press on the button is under way (its own collapse). */
  const unselect = useCallback(() => {
    if (pressing.current) lost.current = true;
    else hold(null);
  }, [hold, pressing]);

  const onSelection = useCallback(
    (data: Record<string, unknown>) => {
      const selection = selectionOf(data);
      if (selection === null) return;
      // The page has nothing selected. Kept through a press on the button,
      // which is the press's own collapse and not a choice the reader made.
      if (selection.text === "") return unselect();
      if (document.activeElement !== frame.current) return;
      // A new selection is a new press's business, not the last one's collapse.
      lost.current = false;
      const { text, heading, anchor, rect } = selection;
      if (!samePassage(heldRef.current?.passage, selection)) spendActivation();
      const at = placeOf(rect, frame.current, wrapper.current, coarseRef.current);
      const seq = typeof data.seq === "number" ? data.seq : undefined;
      hold({ passage: { text, heading, anchor }, at, seq });
    },
    [frame, wrapper, hold, unselect],
  );

  const onShare = useCallback((data: Record<string, unknown>, focused: boolean) => {
    const story = storyOf(data);
    if (story === null || !focused) return;
    if (navigator.userActivation?.isActive === false) return;
    spendActivation();
    void shareRef.current(story);
  }, []);

  const heldNow = useCallback(() => heldRef.current, []);

  return { held, heldNow, press, toast: dump.toast, take: takeNow, forget, onSelection, onShare };
}
