import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Rsvp } from "@/components/rsvp";
import { TAKE_HOST, TakeButton } from "@/components/takes/take-button-view";
import { useHtmlTake } from "@/components/takes/use-html-take";
import { usePageReload } from "@/components/use-page-reload";
import { encodePath } from "@/lib/notes/links/note-path";
import { postLook } from "@/lib/panes/html/page-look";
import { pageData, pageText } from "@/lib/panes/html/page-messages";
import { spendActivation } from "@/lib/panes/html/user-activation";
import { findQuote } from "@/lib/panes/rsvp/rsvp";
import { textWords } from "@/lib/panes/rsvp/rsvp-sources";
import { type RsvpAsk, useRsvpAsk } from "@/lib/panes/rsvp/use-rsvp";
import { useViewport } from "@/lib/ui/input/use-viewport";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/ui/keys/leader-keys";
import { beginLeader, paneOpener } from "@/lib/ui/keys/which-key";
import { currentPalette, currentTheme, onThemeChange } from "@/lib/ui/theme";

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
  const { coarse } = useViewport();
  const html = useHtmlTake({ path, archive, frame, wrapper, coarse });
  const { held, heldNow, press, toast, take, forget, onSelection, onShare } = html;
  /** A relayed `y` took this visit, where no activation is spent. */
  const relayedTaken = useRef(false);

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
  /** The page's script said hello since the frame's last load. */
  const greeted = useRef(false);

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

  /** The reader's own take, which starts a new visit for the page's `y` (`relayedTaken`). */
  function takeAsReader() {
    relayedTaken.current = false;
    return take();
  }

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
        // asks as it loads. Answered whatever has the focus. A new document, such
        // as a link followed in the page, drops what the old one held (#1295).
        case "hello":
          greeted.current = true;
          forget();
          postLook(frame.current);
          return;
        // The answer to `pageText`, whatever has the focus: the reader asked for it.
        case "text":
          if (typeof data.text === "string") textWait.current?.(data.text);
          return;
        case "selection":
          return onSelection(data);
        // A press on a story's Share later button. The page can post this itself,
        // so it spends the reader's press (#1297), and the toast's Undo takes a forged one back.
        case "share":
          return onShare(data, focused);
        case "key":
          if (focused) onPageKey(data.key);
      }
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
      if (heldNow() === null || relayedTaken.current || !active) return;
      relayedTaken.current = !spendActivation();
      void take();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [startLeader, forget, onSelection, onShare, heldNow, take]);

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
    } else if (key === "y" && heldNow() !== null) {
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
      <div ref={wrapper} className={TAKE_HOST}>
        <iframe
          key={`frame-${reload.loads}`}
          ref={frame}
          src={framed}
          title={path}
          // The page's script asks as it parses, which a listener set late in the page
          // can miss, so the load posts the look too. Both are idempotent. A page
          // with no script of kasten's, such as a blocked link's, said no hello.
          onLoad={() => {
            if (!greeted.current) forget();
            greeted.current = false;
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
        {toast}
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
              const text = heldNow()?.passage.text;
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
