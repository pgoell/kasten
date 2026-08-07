import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { type EditorCommands, TERMINAL, TERMINAL_CHORD } from "@/lib/key-bindings";
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
  /** herdr session name, which `?arg=` hands to `herdr --session`. */
  session: string;
  /** What a `TERMINAL` chord reaches. The route hands down the same object the editors get. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /** Whether the pane this sits in is the focused one. See `Editor`. */
  focused?: boolean;
}

/**
 * A shell in a pane: one xterm terminal on one WebSocket to ttyd.
 *
 * The socket and the terminal are built together and torn down together, so
 * the effect keys on the session name and nothing else. Everything on the wire
 * is `ttyd.ts`, which is where the format is tested.
 */
export function TerminalPane({
  session,
  commands,
  focusSignal,
  focused = true,
}: TerminalPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Read through a ref, the way `editor.tsx` reads the same prop. The terminal
  // and its socket are built in one effect keyed on `session`, and naming
  // `commands` in that effect's dependencies would rebuild both every time the
  // route's memo took a new identity. It takes one on every `data` change, and
  // the `EventSource` invalidates `data` on every vault write, so an agent
  // writing notes in a terminal would tear down its own socket and lose its
  // scrollback.
  const commandsRef = useRef(commands);
  useEffect(() => {
    commandsRef.current = commands;
  });

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

    // The leader is the space bar and a shell must receive the space bar, so
    // the only keys kasten takes back are these. `false` stops xterm handing
    // the event to the PTY; `true` lets every other key through untouched.
    //
    // The modifiers are compared for equality rather than tested for truth: a
    // handler that fired on ctrl and shift while ignoring alt would eat chords
    // the shell wants.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const held =
        event.ctrlKey === TERMINAL_CHORD.ctrlKey &&
        event.shiftKey === TERMINAL_CHORD.shiftKey &&
        event.altKey === TERMINAL_CHORD.altKey &&
        event.metaKey === TERMINAL_CHORD.metaKey;
      if (!held) return true;

      const binding = TERMINAL.find((row) => row.key === event.key);
      if (binding === undefined) return true;

      event.preventDefault();
      commandsRef.current[binding.command]();
      return false;
    });

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
      // sockets are two herdr clients on one session mirroring each other. A
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

  // Coming back to the tab, the same way `Editor` does it and for the same
  // reason: the browser lands on the body when the page had nothing focused as
  // you left it. Without this a terminal pane never revives, because the
  // editors in the other panes are the only things claiming the focus back, and
  // the shell then drops every key until you click into it. `focused` is what
  // keeps the panes from racing each other for it.
  useEffect(() => {
    function onWindowFocus() {
      const active = document.activeElement;
      if (focused && (!active || active === document.body)) termRef.current?.focus();
    }

    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [focused]);

  // No border of its own: `pane-layout.tsx` draws that already.
  return <div ref={host} className="h-full w-full" />;
}
