import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { encodePath } from "@/lib/note-path";
import { currentPalette, currentTheme, onThemeChange } from "@/lib/theme";
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

interface HtmlPaneProps {
  /** Vault-relative path of the page to show. */
  path: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /** That a click landed in the page, which no ancestor is told. */
  onFocus: () => void;
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-k-muted uppercase";

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
export function HtmlPane({ path, commands, focusSignal, onFocus }: HtmlPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
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

  // The page's script posts its keys here. Only a message from this pane's own
  // frame counts: a nested frame in the page, a window it opened and another
  // pane's frame all reach the window's listener too.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source === null || event.source !== frame.current?.contentWindow) return;
      if (typeof event.data !== "object" || event.data === null) return;
      const { kasten, key } = event.data as { kasten?: unknown; key?: unknown };

      // The page cannot read the theme itself, its origin being opaque, so it
      // asks as it loads. Answered whatever has the focus.
      if (kasten === "hello") {
        postLook(frame.current);
        return;
      }

      // A key counts only while the frame holds the focus, so a page in the
      // background cannot open the panel or take the focus from the pane.
      if (kasten !== "key" || document.activeElement !== frame.current) return;
      if (key === " ") startLeader();
      else if (key === "?") commandsRef.current.showHelp();
      // Escape gives the keys back to Kasten, the way a click outside the frame does.
      else if (key === "Escape") panel.current?.focus();
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [startLeader]);

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
    }
  }

  // Encoded for the reason the image pane gives. The header's link and the frame
  // read the same address, so the page opens in a tab as it is drawn here.
  const url = `/api/html/${encodePath(path)}`;

  return (
    <section
      ref={panel}
      data-html-pane
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="page"
      className="flex h-full flex-col bg-k-bg outline-none"
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
          className="inline-flex shrink-0 items-center text-[12px] text-k-muted hover:text-k-accent focus-visible:text-k-accent pointer-coarse:min-h-11"
        >
          Open in a browser tab
        </a>
      </header>

      <iframe
        ref={frame}
        src={url}
        title={path}
        // No `allow-same-origin`: with it and `allow-scripts` together a page
        // could lift its own sandbox off and run as kasten.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        // White behind the page, which is what a page that sets no background
        // was written to be read on.
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </section>
  );
}
