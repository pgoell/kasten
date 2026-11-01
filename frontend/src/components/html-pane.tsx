import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Rsvp } from "@/components/rsvp";
import { TakeButton } from "@/components/take-button-view";
import { useDumpTake } from "@/components/use-dump-take";
import { usePageReload } from "@/components/use-page-reload";
import { readClock } from "@/lib/clock";
import { type Story, shareLine, storyOf } from "@/lib/html/html-share";
import { postLook } from "@/lib/html/page-look";
import { pageData, pageText } from "@/lib/html/page-messages";
import { fileOf, type PagePassage, pageLink } from "@/lib/html-take";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { encodePath } from "@/lib/note-path";
import {
  type Anchor,
  low,
  placeFor,
  type Rect,
  samePassage,
  selectionOf,
} from "@/lib/page-selection";
import { findQuote } from "@/lib/rsvp/rsvp";
import { textWords } from "@/lib/rsvp/rsvp-sources";
import { type RsvpAsk, useRsvpAsk } from "@/lib/rsvp/use-rsvp";
import { usePressGuard } from "@/lib/take-button";
import { currentPalette, currentTheme, onThemeChange } from "@/lib/theme";
import { useViewport } from "@/lib/use-viewport";
import { spendActivation } from "@/lib/user-activation";
import { beginLeader, paneOpener } from "@/lib/which-key";

/** The passage held, and where its button goes, or null where it has no place. */
interface Held {
  passage: PagePassage;
  at: Anchor | null;
  /** The page's number for the selection, which a take hands back to mark it (#897). */
  seq: number | undefined;
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-k-muted uppercase";

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

interface HtmlPaneProps {
  /** Vault-relative path of the page to show. */
  path: string;
  /** The heading a followed link named, which the page opens at. */
  anchor?: string;
  /** Whether the recent notes the toast offers include archived ones. */
  archive?: boolean;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /** That a click landed in the page, which no ancestor is told. */
  onFocus: () => void;
  /** Raised for this pane by `Space r r` and `Space r h`. */
  rsvp?: RsvpAsk;
}

/**
 * One HTML page out of the vault. The frame is sandboxed here and again by the
 * policy `GET /api/html` sends. Keys typed inside are the page's, so the page
 * script forwards Space, `?` and Escape up to the panel.
 */
export function HtmlPane({
  path,
  anchor,
  archive = false,
  commands,
  focusSignal,
  onFocus,
  rsvp,
}: HtmlPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  // A touch screen's button goes under the words. Read by the page's listener,
  // which is added once, so it is mirrored in a layout effect like the others.
  const { coarse } = useViewport();
  const coarseRef = useRef(coarse);
  useLayoutEffect(() => {
    coarseRef.current = coarse;
  });

  /**
   * The passage held for a take, mirrored in a ref for the same reason the
   * commands are: the page's listener is added once and reads it as it is now,
   * and a `y` answered a render late would take the one before.
   */
  const [held, setHeld] = useState<Held | null>(null);
  const heldRef = useRef<Held | null>(null);
  const hold = useCallback((next: Held | null) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  /**
   * A collapse the page sent while a press on the button was under way, which
   * the press guard holds back. It is answered when the press lands outside the
   * button, the way the book answers its own (`use-book-take.ts`).
   */
  const lost = useRef(false);
  /**
   * The stories saved to share later from this page, by take id, so an Undo
   * tells the page which button to give back. `saving` holds their ids in the
   * page as well as any on their way, so a second press adds no second todo.
   */
  const shared = useRef(new Map<number, string>());
  const saving = useRef(new Set<string>());
  /** A relayed `y` took this visit, where no activation is spent. */
  const relayedTaken = useRef(false);
  const { pressing, press } = usePressGuard(() => {
    if (lost.current) {
      lost.current = false;
      hold(null);
    }
  });

  /**
   * The take into today's dump, the toast about it and the Undo. The page is
   * told of the take through the take's `onKept` and of its Undo through `onUnmarked`.
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

  /**
   * What a page change or a reload leaves behind: the old words' selection, the
   * press over them and their toast.
   */
  const forget = useCallback(() => {
    lost.current = false;
    shared.current.clear();
    saving.current.clear();
    hold(null);
    dumpForget();
  }, [hold, dumpForget]);
  // Read against the path last shown, so a pane that starts on the same page
  // keeps what it holds. A new page is a new document, which `onLoad` hears of
  // as well where a browser loads it.
  const shown = useRef(path);
  useEffect(() => {
    if (shown.current === path) return;
    shown.current = path;
    forget();
  }, [forget, path]);
  // Off a ref, because the route hands a new `onFocus` on every render and the
  // listener below would come off the window and go back on with each (#592).
  // Written in a layout effect, which runs in the commit's own task, so a click
  // heard between the commit and the passive effects reaches the new one.
  const onFocusRef = useRef(onFocus);
  useLayoutEffect(() => {
    onFocusRef.current = onFocus;
  });
  // The same for the commands: the page's message listener is added once and
  // must run the commands the route handed last.
  const commandsRef = useRef(commands);
  useLayoutEffect(() => {
    commandsRef.current = commands;
  });

  const reload = usePageReload(path, frame, relayedTaken, forget);

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  useEffect(() => onThemeChange(() => postLook(frame.current)), []);

  const reading = useRsvpAsk(rsvp);
  /** Where the page's text goes once its script answers, while a read waits for it. */
  const textWait = useRef<((text: string) => void) | null>(null);

  /**
   * Space, from a key of this pane or from the page. The panel takes it. Where
   * none is mounted the pane keeps the sequence itself, and takes the focus so
   * the next key comes to `onKeyDown`.
   */
  const startLeader = useCallback(() => {
    if (beginLeader(paneOpener(commandsRef.current))) return;
    panel.current?.focus();
    setPending(" ");
  }, []);

  /**
   * Put the held passage into today's dump, through the dump path the take
   * shares with the PDF pane. Taken off the ref at once, so a second `y` finds
   * nothing to take. A passage the dump did not keep goes back on hold, unless
   * the reader selected another since `y` (#899).
   */
  async function take() {
    // Taken off the ref at once, and the press over with it, so a second `y`
    // finds nothing to take and a collapse after this is answered.
    pressing.current = false;
    lost.current = false;
    const taken = heldRef.current;
    if (taken === null) return;
    heldRef.current = null;

    const { passage } = taken;
    const kept = await dump.take({
      text: passage.text,
      linkIn: (note) => pageLink(path, passage, note),
      source: passage.heading === "" ? fileOf(path) : `${passage.heading}, ${fileOf(path)}`,
      top: low(taken.at),
      onKept: (id) =>
        frame.current?.contentWindow?.postMessage({ kasten: "take", id, seq: taken.seq }, "*"),
    });
    if (!kept && heldRef.current === null) hold(taken);
  }
  /**
   * Save a story to share later: a `#share` todo in today's dump, linked to the
   * story's source and to its place in the paper. A story already saved from
   * this page is not saved twice. Kept off the selection, so a passage held for
   * a take stays held.
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

  /** The reader's own take, which starts a new visit for the page's `y` (`relayedTaken`). */
  function takeAsReader() {
    relayedTaken.current = false;
    return take();
  }

  // The listener is added once, so it reaches the take as it is now through this.
  const takeRef = useRef(take);
  useLayoutEffect(() => {
    takeRef.current = take;
  });

  // The page's script posts its keys here, through `pageData`.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = pageData(event, frame.current);
      if (data === null) return;
      // A key, a selection or a share counts only while the frame holds the
      // focus, so a page in the background cannot act on the pane.
      const focused = document.activeElement === frame.current;
      switch (data.kasten) {
        // The page cannot read the theme itself, its origin being opaque, so it
        // asks as it loads. Answered whatever has the focus.
        case "hello":
          postLook(frame.current);
          return;
        // The answer to `pageText`, whatever has the focus: the reader asked for it.
        case "text":
          if (typeof data.text === "string") textWait.current?.(data.text);
          return;
        case "selection":
          return onSelection(data);
        // A press on a story's Share later button. The page can post this itself,
        // so it counts only while the reader has just pressed something, and the
        // toast's Undo takes a forged one back.
        case "share":
          return onShare(data, focused);
        case "key":
          if (focused) onPageKey(data.key);
      }
    }

    function onSelection(data: Record<string, unknown>) {
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
    }

    function unselect() {
      if (pressing.current) lost.current = true;
      else hold(null);
    }

    function onShare(data: Record<string, unknown>, focused: boolean) {
      const story = storyOf(data);
      if (story === null || !focused) return;
      if (navigator.userActivation?.isActive === false) return;
      void shareRef.current(story);
    }

    function onPageKey(key: unknown) {
      // A page's `y` takes once per press (`spendActivation`).
      if (key === "y") return relayTake();
      if (key === " ") startLeader();
      else if (key === "?") commandsRef.current.showHelp();
      // Escape gives the keys back to Kasten, the way a click outside the frame does.
      else if (key === "Escape") panel.current?.focus();
    }

    function relayTake() {
      const active = navigator.userActivation?.isActive !== false;
      if (heldRef.current === null || relayedTaken.current || !active) return;
      relayedTaken.current = !spendActivation();
      void takeRef.current();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [startLeader, hold, pressing]);

  // A click into a frame moves the focus out of this document, which tells the
  // window it lost it and tells no element anything. By the time `blur` fires
  // the frame is the active element, so that is how the click is seen.
  useEffect(() => {
    function onBlur() {
      if (document.activeElement !== frame.current) return;
      onFocusRef.current();
      relayedTaken.current = false;
    }
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  // Its own leader read, not `useLeader`: the page's Space starts a sequence
  // too, through `startLeader`. Nothing is bound beside it but `y`.
  function feedLeader(event: React.KeyboardEvent) {
    const sequence = pending + event.key;
    const wanted = sequence.slice(1);
    const run = leaderAction(wanted, commands);
    setPending(!run && leaderPrefix(wanted) ? sequence : "");
    if (!run) return;
    event.preventDefault();
    run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    if (heldModifier(key)) return;
    if (pending) return feedLeader(event);
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (key === " ") {
      event.preventDefault();
      startLeader();
    } else if (key === "y" && heldRef.current !== null) {
      event.preventDefault();
      void takeAsReader();
    }
  }

  // Encoded for the reason the image pane gives. The header's link is the bare
  // address, so a tab opened from it shows the page's own fallback.
  const url = `/api/html/${encodePath(path)}`;
  // The frame's address carries the look it opens in, which a page that opts in
  // needs before its first paint. Read once per path: a new address reloads the
  // page and loses its scroll, so a switch reaches it by `postLook` instead. The
  // heading a link named is the fragment, which the page jumps to on its own.
  const framed = useMemo(() => {
    const look = `${url}?theme=${currentTheme()}&palette=${currentPalette()}`;
    return anchor === undefined ? look : `${look}#${encodeURIComponent(anchor)}`;
  }, [url, anchor]);

  return (
    <section
      ref={panel}
      data-html-pane
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="page"
      className="relative flex h-full flex-col bg-k-bg outline-none"
    >
      <header className="flex items-center gap-3 border-b border-k-rule px-3 py-1">
        <span className={LABEL}>page</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-k-ink" title={path}>
          {path}
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener"
          // In the words the issue gives, not the label's capitals, so it reads
          // as a link and not as a second name for the pane.
          className="inline-flex shrink-0 items-center text-[11px] text-k-link hover:text-k-accent focus-visible:text-k-accent active:text-k-accent pointer-coarse:min-h-11"
        >
          Open in a browser tab
        </a>
      </header>

      {/* The wrapper the take button is placed in, so its place is the frame's own. */}
      <div ref={wrapper} className="relative flex min-h-0 flex-1 flex-col">
        <iframe
          key={`frame-${reload.loads}`}
          ref={frame}
          src={framed}
          title={path}
          // The page's script asks as it parses, which a listener set late in the page
          // can miss, so the load posts the look too. Both are idempotent.
          onLoad={() => {
            forget();
            postLook(frame.current);
            reload.loaded();
          }}
          // No `allow-same-origin`: with it and `allow-scripts` together a page
          // could lift its own sandbox off and run as kasten.
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          // White behind the page, which is what a page that sets no background
          // was written to be read on.
          className="min-h-0 flex-1 border-0 bg-white"
        />
        {held?.at && (
          <TakeButton
            at={held.at}
            label={held.passage.heading}
            press={press}
            onTake={() => void takeAsReader()}
          />
        )}
        {/* In the wrapper, so `top` sits under the header and the frame bounds the toast. */}
        {dump.toast}
      </div>
      {reading.open && (
        <Rsvp
          key={reading.open.signal}
          source={{
            path,
            words: async () => textWords(await pageText(frame.current, textWait)),
            // The passage held for a take is the page's selection, so "from
            // here" starts at it, and resumes where nothing is selected.
            here: (words) => {
              const text = heldRef.current?.passage.text;
              return text === undefined ? null : findQuote(words, text);
            },
          }}
          here={reading.open.here}
          onClose={() => {
            reading.close();
            panel.current?.focus();
          }}
        />
      )}
    </section>
  );
}
