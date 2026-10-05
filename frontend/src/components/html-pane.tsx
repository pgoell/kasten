import { useEffect, useRef, useState } from "react";
import { type EditorCommands, heldModifier, leaderAction, leaderPrefix } from "@/lib/key-bindings";

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

const LABEL = "shrink-0 text-[11px] tracking-wide text-one-muted uppercase";

/**
 * One HTML page out of the vault, drawn the way it draws itself.
 *
 * What a research run leaves beside its notes: a report with its own styles
 * and a deck with its own script. The image pane's shape with a frame where
 * the `<img>` was. The frame is sandboxed here and again by the policy
 * `GET /api/html` sends, which is the one that also holds a page opened in a
 * tab of its own.
 *
 * Keys typed inside the page are the page's, a deck's arrows above all, so the
 * leader reaches this pane only from its header. A click outside the frame
 * takes them back, the way it does from a book.
 */
export function HtmlPane({ path, commands, focusSignal, onFocus }: HtmlPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // A click into a frame moves the focus out of this document, which tells the
  // window it lost it and tells no element anything. By the time `blur` fires
  // the frame is the active element, so that is how the click is seen.
  useEffect(() => {
    function onBlur() {
      if (document.activeElement === frame.current) onFocus();
    }
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [onFocus]);

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
      setPending(key);
      event.preventDefault();
    }
  }

  return (
    <section
      ref={panel}
      data-html-pane
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="page"
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={LABEL}>html</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg" title={path}>
          {path}
        </span>
      </header>

      <iframe
        ref={frame}
        // `encodeURI` for the reason the image pane gives.
        src={`/api/html/${encodeURI(path)}`}
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
