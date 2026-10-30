import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { keyBytes, type TerminalKey, TerminalKeys, withCtrl } from "@/components/terminal-keys";
import { type EditorCommands, TERMINAL, TERMINAL_CHORD } from "@/lib/key-bindings";
import { onThemeChange } from "@/lib/theme";
import "@xterm/xterm/css/xterm.css";
import {
  closedMessage,
  decodeServer,
  encodeAuth,
  encodeInput,
  encodeResize,
  TTYD_SUBPROTOCOL,
  terminalUrl,
} from "@/lib/ttyd";
import { useViewport } from "@/lib/use-viewport";

/**
 * The theme's colours, read from the tokens the editor paints with, so a pane cannot drift
 * from the note beside it. The ANSI slots the tokens do not name keep xterm's defaults.
 * Shells dim text in `brightBlack`, which is the muted grey.
 */
function kastenTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();

  return {
    background: read("--k-bg"),
    foreground: read("--k-ink"),
    cursor: read("--k-accent"),
    cursorAccent: read("--k-bg"),
    selectionBackground: read("--k-highlight"),
    red: read("--k-danger"),
    green: read("--k-ok"),
    yellow: read("--k-warn"),
    blue: read("--k-accent"),
    cyan: read("--tg-6"),
    magenta: read("--tg-4"),
    brightBlack: read("--k-muted"),
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
 * One xterm terminal on one WebSocket to ttyd. The two are built and torn down together,
 * so the effect keys on the session name alone.
 */
export function TerminalPane({
  session,
  commands,
  focusSignal,
  focused = true,
}: TerminalPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Read through a ref: a new `commands` identity on every vault write would rebuild the
  // terminal and lose its scrollback. Set in a layout effect, so a chord pressed right after
  // commit runs the new commands.
  const commandsRef = useRef(commands);
  useLayoutEffect(() => {
    commandsRef.current = commands;
  });

  const { coarse } = useViewport();
  // The row's Ctrl, armed for one key. The ref is what the terminal's own handler reads, since
  // that handler is built once per session.
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: kastenTheme(),
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim(),
      fontSize: 13,
      // xterm's ANSI defaults are pale for a dark ground, so 4.5:1 darkens them on a light one.
      minimumContrastRatio: 4.5,
    });
    termRef.current = term;
    term.open(element);

    // Only these chords come back to kasten; the shell needs every other key, and `false` stops
    // xterm sending them on. Modifiers compare by equality, or a chord would eat one the shell wants.
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
    // A pane not yet laid out measures as nothing, so fit after the first paint.
    const painted = requestAnimationFrame(() => fit.fit());
    const watching = new ResizeObserver(() => fit.fit());
    watching.observe(element);

    const socket = new WebSocket(terminalUrl(session), [TTYD_SUBPROTOCOL]);
    socket.binaryType = "arraybuffer";

    let opened = false;
    socket.onopen = () => {
      opened = true;
      socket.send(encodeAuth(term.cols, term.rows));
    };
    // `close`, not `error`: only `close` also fires when a running shell ends. There is no
    // reconnect; reopening the pane is the retry.
    socket.onclose = (event) => term.write(closedMessage(opened, event.code));
    socket.onmessage = (message) => {
      const decoded = decodeServer(message.data as ArrayBuffer);
      // Output only: ttyd's title and preference messages are not the shell's.
      if (decoded.kind === "output") term.write(decoded.bytes);
    };

    // Ctrl is spent on the next typed key, but not on an escape sequence: focus and mouse reports
    // start with one, and a phone's letter never does. A bracketed paste or arrow keeps Ctrl armed,
    // which a tap on Ctrl undoes.
    const typing = term.onData((typed) => {
      let data = typed;
      if (ctrlRef.current && !typed.startsWith("\x1b")) {
        data = withCtrl(typed);
        ctrlRef.current = false;
        setCtrl(false);
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeInput(data));
    });
    // Tell the PTY the size fit() chose, or a rewrapped terminal draws at the wrong width.
    const resizing = term.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeResize(cols, rows));
    });
    // Repaints the open shell now, not when the pane is next opened.
    const retheming = onThemeChange(() => {
      term.options.theme = kastenTheme();
    });

    return () => {
      cancelAnimationFrame(painted);
      retheming();
      watching.disconnect();
      resizing.dispose();
      typing.dispose();
      // Our own close is not news: the terminal it would write to is disposed below.
      socket.onclose = null;
      // StrictMode mounts twice in dev, and two live sockets are two herdr clients mirroring
      // one session. A socket still opening is closed the moment it opens.
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.onopen = () => socket.close();
      } else {
        socket.close();
      }
      term.dispose();
      termRef.current = null;
      // Ctrl was armed for this shell, not the next one the route swaps in.
      ctrlRef.current = false;
      setCtrl(false);
    };
  }, [session]);

  // Also on mount, as Editor does it: a new split starts focused, and only
  // its first render can say so.
  useEffect(() => {
    if (focusSignal) termRef.current?.focus();
  }, [focusSignal]);

  // Coming back to the tab, the browser lands on the body when nothing had focus. Without
  // this the shell drops every key until clicked. `focused` stops the panes racing.
  useEffect(() => {
    function onWindowFocus() {
      const active = document.activeElement;
      if (focused && (!active || active === document.body)) termRef.current?.focus();
    }

    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [focused]);

  // The row is gone with the finger, so Ctrl must not stay armed unseen.
  useEffect(() => {
    if (!coarse) {
      ctrlRef.current = false;
      setCtrl(false);
    }
  }, [coarse]);

  function onKey(key: TerminalKey) {
    const term = termRef.current;
    if (term === null) return;
    if (key === "Ctrl") {
      ctrlRef.current = !ctrlRef.current;
      setCtrl(ctrlRef.current);
      return;
    }
    const bytes = keyBytes(key, ctrlRef.current, term.modes.applicationCursorKeysMode);
    ctrlRef.current = false;
    setCtrl(false);
    // `input`, not the socket: it fires onData, so a key scrolls to the prompt like a typed one.
    term.input(bytes);
  }

  // No border of its own, as pane-layout draws one. No room for an on-screen keyboard either:
  // the frame shrinks above one and the ResizeObserver refits.
  return (
    <div className="flex h-full w-full flex-col">
      <div ref={host} className="min-h-0 w-full flex-1" />
      {coarse && <TerminalKeys ctrl={ctrl} onKey={onKey} />}
    </div>
  );
}
