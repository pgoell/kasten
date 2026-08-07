import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import {
  decodeServer,
  encodeAuth,
  encodeInput,
  encodeResize,
  TTYD_SUBPROTOCOL,
  terminalUrl,
} from "@/lib/ttyd";

/**
 * The One colours, read off the same CSS variables the editor is painted from.
 *
 * Read rather than repeated, so the palette stays in `app.css` and a terminal
 * pane cannot drift from the note pane beside it. `getPropertyValue` keeps the
 * leading space a declaration is written with, hence the trim.
 *
 * The bright eight and the rest of the ANSI set are left to xterm's defaults:
 * `app.css` has no values for them, and inventing eight is a design decision
 * nobody asked for.
 */
function oneTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();

  return {
    background: read("--color-one-bg"),
    foreground: read("--color-one-fg"),
    cursor: read("--color-one-cursor"),
    selectionBackground: read("--color-one-selection"),
    // The four named hues are already the ANSI slots they stand for.
    red: read("--color-one-warn"),
    green: read("--color-one-green"),
    yellow: read("--color-one-yellow"),
    blue: read("--color-one-accent"),
  };
}

interface TerminalPaneProps {
  /** tmux session name, which `?arg=` hands to `tmux new -A -s`. */
  session: string;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/**
 * A shell in a pane: one xterm terminal on one WebSocket to ttyd.
 *
 * The socket and the terminal are built together and torn down together, so
 * the effect keys on the session name and nothing else. Everything on the wire
 * is `ttyd.ts`, which is where the format is tested.
 */
export function TerminalPane({ session, focusSignal }: TerminalPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: oneTheme(),
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim(),
      // The size the app sets everything monospaced in.
      fontSize: 13,
    });
    termRef.current = term;
    term.open(element);

    const fit = new FitAddon();
    term.loadAddon(fit);
    // `fit()` measures the container, and a pane that has not been laid out yet
    // measures as nothing. After the first paint rather than in this tick.
    const painted = requestAnimationFrame(() => fit.fit());
    const watching = new ResizeObserver(() => fit.fit());
    watching.observe(element);

    const socket = new WebSocket(terminalUrl(session), [TTYD_SUBPROTOCOL]);
    socket.binaryType = "arraybuffer";

    socket.onopen = () => socket.send(encodeAuth(term.cols, term.rows));
    socket.onmessage = (message) => {
      const decoded = decodeServer(message.data as ArrayBuffer);
      // Only output for now. A title or a preferences blob is ttyd telling the
      // page about itself, and this pane is painted by the app rather than by
      // the server.
      if (decoded.kind === "output") term.write(decoded.bytes);
    };

    const typing = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeInput(data));
    });
    // Tell the PTY what `fit()` just decided, or a rewrapped terminal draws at
    // one width over a shell still writing at another.
    const resizing = term.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeResize(cols, rows));
    });

    return () => {
      cancelAnimationFrame(painted);
      watching.disconnect();
      resizing.dispose();
      typing.dispose();
      // StrictMode mounts, cleans up and mounts again in dev, and two live
      // sockets are two tmux clients on one session mirroring each other. A
      // socket still opening cannot be closed, so it is closed the moment it
      // opens instead.
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.onopen = () => socket.close();
      } else {
        socket.close();
      }
      term.dispose();
      termRef.current = null;
    };
  }, [session]);

  // Mount included, the way `Editor` reads the same prop: a freshly split pane
  // is created focused and its first render is the only chance it gets to say
  // so. A pane that is not the focused one is handed 0 and stays put.
  useEffect(() => {
    if (focusSignal) termRef.current?.focus();
  }, [focusSignal]);

  // No border of its own: `pane-layout.tsx` draws that already.
  return <div ref={host} className="h-full w-full" />;
}
