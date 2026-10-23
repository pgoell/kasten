import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TakeToast } from "@/components/take-toast";
import { updateNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { addHighlight } from "@/lib/highlight";
import { type PagePassage, pageLink, quoteParagraphs, takenQuote } from "@/lib/html-take";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { encodePath, noteName } from "@/lib/note-path";
// Renamed for the reason `use-prompts.tsx` renames it: the take is a dump, and
// the page has no other `flush` to confuse it with.
import { flush as flushOutbox, keep } from "@/lib/outbox";
import { type Anchor, fitButton, placeFor, selectionOf } from "@/lib/page-selection";
import { REFUSED, type Undo, undoFor, undoPassage } from "@/lib/page-undo";
import { periodicNote } from "@/lib/periodic";
import { usePressGuard } from "@/lib/take-button";
import { currentPalette, currentTheme, onThemeChange } from "@/lib/theme";
import { newId } from "@/lib/todo";
import { useViewport } from "@/lib/use-viewport";
import { beginLeader, paneOpener } from "@/lib/which-key";

/**
 * Tells the page the theme and the palette on screen, so a switch reaches it
 * with no reload. The target is `*` because the frame's origin is opaque (it has
 * no `allow-same-origin`), so no origin would match.
 */
function postLook(frame: HTMLIFrameElement | null) {
  const page = frame?.contentWindow;
  page?.postMessage({ kasten: "theme", theme: currentTheme() }, "*");
  page?.postMessage({ kasten: "palette", palette: currentPalette() }, "*");
}

/** The passage held, and where its button goes, or null where it has no place. */
interface Held {
  passage: PagePassage;
  at: Anchor | null;
}

/** The toast on screen: what it says, and the take it can undo, if it can. */
interface Toast {
  id: number;
  title: string;
  passage: PagePassage;
  source: string;
  undo?: Undo;
}

/** The file's own name, which is what a passage with no heading says it came from. */
function fileOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-k-muted uppercase";

/**
 * The button's look. The book's `TAKE` in `book-pane.tsx`, with the coarse
 * pointer's height from the footer's button. The placement is added per take.
 */
const TAKE =
  "absolute flex h-6 -translate-x-1/2 items-center gap-2 rounded border border-k-muted bg-k-bg px-2 font-mono text-k-ink text-xs pointer-coarse:min-h-11";

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

  // The drawn size keeps the button inside the frame, and only the DOM knows it.
  const button = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const drawn = button.current;
    if (drawn === null) return;
    if (drawn.offsetWidth !== size.width || drawn.offsetHeight !== size.height) {
      setSize({ width: drawn.offsetWidth, height: drawn.offsetHeight });
    }
  });

  /**
   * A collapse the page sent while a press on the button was under way, which
   * the press guard holds back. It is answered when the press lands outside the
   * button, the way the book answers its own (`use-book-take.ts`).
   */
  const lost = useRef(false);
  const { pressing, press } = usePressGuard(() => {
    if (lost.current) {
      lost.current = false;
      hold(null);
    }
  });

  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);
  const dismiss = useCallback(() => setToast(null), []);
  // The take's mark on the page, counted per pane so each take has its own id.
  const marks = useRef(0);

  /**
   * What a page change or a reload leaves behind: the selection taken from the
   * old words, the press over them and the toast about them.
   */
  const forget = useCallback(() => {
    lost.current = false;
    hold(null);
    setToast(null);
  }, [hold]);
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

  /** A line in the toast's source: the heading the words sit under, then the file's name. */
  function show(title: string, passage: PagePassage, undo?: Undo) {
    toastId.current += 1;
    const name = fileOf(path);
    const source = passage.heading === "" ? name : `${passage.heading}, ${name}`;
    setToast({ id: toastId.current, title, passage, source, undo });
  }

  /**
   * Put the held passage into today's dump, the way `Space cd` puts a thought
   * in: kept on the device first, sent by the outbox, and undone out of the
   * daily note if it landed. Taken off the ref at once, so a second `y` finds
   * nothing to take.
   */
  async function take() {
    // Taken off the ref at once, and the press over with it, so a second `y`
    // finds nothing to take and a collapse after this is answered.
    pressing.current = false;
    lost.current = false;
    const taken = heldRef.current;
    if (taken === null) return;
    heldRef.current = null;

    const now = new Date();
    const quote = takenQuote(path, taken.passage);
    const daily = periodicNote("daily", now).path;
    marks.current += 1;
    const id = marks.current;

    await keep(quote, readClock(now).date).then(
      async (dump) => {
        hold(null);
        // Marked once the words are safe on the device, which is the only point
        // at which the page's selection may be called taken.
        frame.current?.contentWindow?.postMessage({ kasten: "take", id }, "*");

        // The same answers `capture` gives, in the take's words.
        const { waiting, failure } = await flushOutbox();
        const mine = waiting.find((each) => each.id === dump.id);
        if (mine === undefined) {
          show("Taken into today's dump", taken.passage, await undoFor(daily, quote, id));
        } else if (mine.refused !== undefined) {
          show(mine.refused, taken.passage);
        } else if (failure?.kind === "sign-in") {
          show("Taken, waiting to send: sign in again", taken.passage);
        } else {
          show(`Taken, waiting to send (${waiting.length} waiting)`, taken.passage);
        }
      },
      (error: unknown) => {
        hold(taken);
        show(error instanceof Error ? error.message : "The take was not kept", taken.passage);
      },
    );
  }
  // The listener is added once, so it reaches the take as it is now through this.
  const takeRef = useRef(take);
  useLayoutEffect(() => {
    takeRef.current = take;
  });

  /**
   * Take the dump line back out of the daily note, if the note has not changed
   * since the take. It is read again first and written under the base it was
   * read with, so a write that landed in between is refused, not overwritten.
   */
  async function undoTake(undo: Undo) {
    const outcome = await undoPassage(undo);
    if (outcome.state === "undone") {
      frame.current?.contentWindow?.postMessage({ kasten: "untake", id: undo.id }, "*");
      setToast(null);
      return;
    }
    // The toast says why Undo did nothing, and loses the Undo it can no longer make.
    const title = outcome.state === "refused" ? REFUSED : outcome.message;
    setToast((current) => current && { ...current, title, undo: undefined });
  }

  /**
   * Write the passage under `## Highlights` in a note the reader picked, in the
   * book's own format. The dump line stays where it is.
   */
  function putInto(id: number, notePath: string, passage: PagePassage) {
    const highlight = {
      text: quoteParagraphs(passage.text).join("\n"),
      chapter: pageLink(path, passage),
    };
    void updateNote(notePath, (text) => addHighlight(text, highlight, newId("hl-"))).then(
      () =>
        setToast((current) =>
          current?.id === id ? { ...current, title: `Put into ${noteName(notePath)}` } : current,
        ),
      (error: unknown) =>
        setToast((current) =>
          current?.id === id
            ? { ...current, title: error instanceof Error ? error.message : "Not written" }
            : current,
        ),
    );
  }

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
      // A `y` takes what is held. A browser with a user activation to read says
      // whether this key came from the reader, and one without it is not asked.
      if (key === "y") {
        if (heldRef.current !== null && navigator.userActivation?.isActive !== false) {
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
      if (document.activeElement === frame.current) onFocusRef.current();
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
      void take();
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

  const undo = toast?.undo;

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
          <button
            ref={button}
            type="button"
            aria-label="Take the passage"
            data-take
            {...press}
            onClick={() => void take()}
            style={fitButton(held.at, size)}
            className={held.at.above ? `${TAKE} -translate-y-full` : TAKE}
          >
            <span>Take</span>
            <span className="text-k-muted">y</span>
            {held.passage.heading !== "" && (
              <span className="min-w-0 max-w-64 truncate text-k-muted">{held.passage.heading}</span>
            )}
          </button>
        )}
      </div>

      {toast && (
        <TakeToast
          key={toast.id}
          title={toast.title}
          passage={toast.passage.text}
          source={toast.source}
          archive={archive}
          onUndo={undo === undefined ? undefined : () => void undoTake(undo)}
          onPut={(notePath) => putInto(toast.id, notePath, toast.passage)}
          onDone={dismiss}
        />
      )}
    </section>
  );
}
