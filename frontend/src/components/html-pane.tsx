import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TakeButton } from "@/components/take-button-view";
import { useDumpTake } from "@/components/use-dump-take";
import { fileOf, type PagePassage, pageLink, takenQuote } from "@/lib/html-take";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { encodePath } from "@/lib/note-path";
import { postLook } from "@/lib/page-look";
import { type Anchor, low, placeFor, selectionOf } from "@/lib/page-selection";
import { usePressGuard } from "@/lib/take-button";
import { currentPalette, currentTheme, onThemeChange } from "@/lib/theme";
import { useViewport } from "@/lib/use-viewport";
import { beginLeader, paneOpener } from "@/lib/which-key";

/** The passage held, and where its button goes, or null where it has no place. */
interface Held {
  passage: PagePassage;
  at: Anchor | null;
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-k-muted uppercase";

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
}

/**
 * One HTML page out of the vault, drawn the way it draws itself.
 *
 * What a research run leaves beside its notes: a report with its own styles
 * and a deck with its own script. The image pane's shape with a frame where
 * the `<img>` was. The frame is sandboxed here and again by the policy
 * `GET /api/html` sends, which is the one that also holds a page opened in a
 * tab of its own.
 *
 * Keys typed inside the page are the page's, a deck's arrows above all. The
 * page script sends Space, `?` and Escape up to here, so the leader and the key
 * help still reach the panel from inside it. A click outside the frame takes
 * the keys back, the way it does from a book.
 */
export function HtmlPane({
  path,
  anchor,
  archive = false,
  commands,
  focusSignal,
  onFocus,
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
  /** Whether the page's relayed `y` has taken in this visit: one per visit, see `takeAsReader`. */
  const relayedTaken = useRef(false);
  const { pressing, press } = usePressGuard(() => {
    if (lost.current) {
      lost.current = false;
      hold(null);
    }
  });

  /**
   * The take into today's dump, the toast about it and the Undo. The page is
   * told of the take through `onMarked` and of its Undo through `onUnmarked`.
   */
  const dump = useDumpTake({
    archive,
    onMarked: (id) => {
      // A selection made after `y` is the reader's next one, so only a hold that is still
      // the take's own is cleared (the page's selection message lands while the keep runs).
      if (heldRef.current === null) hold(null);
      frame.current?.contentWindow?.postMessage({ kasten: "take", id }, "*");
    },
    onUnmarked: (id) => frame.current?.contentWindow?.postMessage({ kasten: "untake", id }, "*"),
  });
  const dumpForget = dump.forget;

  /**
   * What a page change or a reload leaves behind: the selection taken from the
   * old words, the press over them and the toast about them.
   */
  const forget = useCallback(() => {
    lost.current = false;
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

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  useEffect(() => onThemeChange(() => postLook(frame.current)), []);

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
   * nothing to take. A passage the dump did not keep goes back on hold.
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
      quote: takenQuote(path, passage),
      text: passage.text,
      link: pageLink(path, passage),
      source: passage.heading === "" ? fileOf(path) : `${passage.heading}, ${fileOf(path)}`,
      top: low(taken.at),
    });
    if (!kept) hold(taken);
  }
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

  // The page's script posts its keys here. Only a message from this pane's own
  // frame counts: a nested frame in the page, a window it opened and another
  // pane's frame all reach the window's listener too.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      if (typeof event.data !== "object" || event.data === null) return;
      const data = event.data as Record<string, unknown>;
      const { kasten, key } = data;

      // The page cannot read the theme itself, its origin being opaque, so it
      // asks as it loads. Answered whatever has the focus.
      if (kasten === "hello") {
        postLook(frame.current);
        return;
      }

      if (kasten === "selection") {
        const selection = selectionOf(data);
        if (selection === null) return;
        // The page has nothing selected. Kept through a press on the button,
        // which is the press's own collapse and not a choice the reader made.
        if (selection.text === "") {
          if (pressing.current) lost.current = true;
          else hold(null);
          return;
        }
        // A selection counts only while the page holds the focus, so a page in
        // the background cannot put a button on the reader's pane.
        if (document.activeElement !== frame.current) return;
        // A new selection is a new press's own business, not the last one's collapse.
        lost.current = false;
        const { text, heading, anchor, rect } = selection;
        const at =
          rect === null || frame.current === null || wrapper.current === null
            ? null
            : placeFor(frame.current, wrapper.current, rect, coarseRef.current);
        hold({ passage: { text, heading, anchor }, at });
        return;
      }

      // A key counts only while the frame holds the focus, so a page in the
      // background cannot open the panel or take the focus from the pane.
      if (kasten !== "key" || document.activeElement !== frame.current) return;
      // A page's `y` takes once per visit. The user activation only narrows it:
      // a click in the page gives the window one too, so it proves no keypress.
      if (key === "y") {
        if (
          heldRef.current !== null &&
          !relayedTaken.current &&
          navigator.userActivation?.isActive !== false
        ) {
          relayedTaken.current = true;
          void takeRef.current();
        }
        return;
      }
      if (key === " ") startLeader();
      else if (key === "?") commandsRef.current.showHelp();
      // Escape gives the keys back to Kasten, the way a click outside the frame does.
      else if (key === "Escape") panel.current?.focus();
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

  // The leader block the image pane carries, with nothing bound beside it.
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    if (heldModifier(key)) return;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      setPending(!run && leaderPrefix(wanted) ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }

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
          ref={frame}
          src={framed}
          title={path}
          // The page's script asks as it parses, which a listener set late in the page
          // can miss, so the load posts the look too. Both are idempotent.
          onLoad={() => {
            forget();
            postLook(frame.current);
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
    </section>
  );
}
