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
 * The theme's colours, read off the same tokens the editor is painted from.
 *
 * Read rather than repeated, so the palette stays in `kasten-theme.css` and a
 * terminal pane cannot drift from the note pane beside it. `getPropertyValue`
 * keeps the leading space a declaration is written with, hence the trim.
 *
 * The ANSI slots the tokens name are the ones they stand for, and the rest are
 * left to xterm's defaults: the token file has no values for them, and inventing
 * them is a design decision nobody asked for. `brightBlack` is the one bright
 * slot named: shells draw dimmed text in it, and the muted token is that grey.
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
  //
  // Written in a layout effect, which runs in the commit's own task, so a
  // chord pressed between the commit and the passive effects runs the new
  // commands rather than the ones before.
  const commandsRef = useRef(commands);
  useLayoutEffect(() => {
    commandsRef.current = commands;
  });

  const { coarse } = useViewport();
  // The key row's Ctrl, armed for one key. The state paints the button and the
  // ref is what the terminal's own handler reads, since that handler is built
  // once per session and would otherwise hold the first render's answer.
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);

  useEffect(() => {
    const element = host.current;
    if (element === null) return;

    const term = new Terminal({
      cursorBlink: true,
      theme: kastenTheme(),
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim(),
      // The size the app sets everything monospaced in.
      fontSize: 13,
      // xterm's ANSI defaults are pale for a dark ground, so 4.5:1 darkens them on a light one.
      minimumContrastRatio: 4.5,
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

    let opened = false;
    socket.onopen = () => {
      opened = true;
      socket.send(encodeAuth(term.cols, term.rows));
    };
    // `close` and not `error`: a failed handshake fires both, and only `close`
    // also fires when a shell that was running ends. There is no reconnect;
    // reopening the pane is the retry, and the message says so.
    socket.onclose = (event) => term.write(closedMessage(opened, event.code));
    socket.onmessage = (message) => {
      const decoded = decodeServer(message.data as ArrayBuffer);
      // Only output for now. A title or a preferences blob is ttyd telling the
      // page about itself, and this pane is painted by the app rather than by
      // the server.
      if (decoded.kind === "output") term.write(decoded.bytes);
    };

    // Ctrl is spent here on the next thing typed, and on nothing that starts
    // with an escape. xterm answers the program through this same event: a
    // focus report, a mouse report, a reply to a query. With reporting on, the
    // tap that raises the keyboard sends one, and it would otherwise take the
    // Ctrl meant for the letter after it. A letter typed on a phone keyboard
    // never starts with an escape; the row's own keys can, and spend Ctrl in
    // `onKey`. A bracketed paste and an arrow from a hardware keyboard start
    // with one too and leave Ctrl armed, which a tap on Ctrl undoes.
    const typing = term.onData((typed) => {
      let data = typed;
      if (ctrlRef.current && !typed.startsWith("\x1b")) {
        data = withCtrl(typed);
        ctrlRef.current = false;
        setCtrl(false);
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeInput(data));
    });
    // Tell the PTY what `fit()` just decided, or a rewrapped terminal draws at
    // one width over a shell still writing at another.
    const resizing = term.onResize(({ cols, rows }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeResize(cols, rows));
    });
    // xterm takes a new theme on its options while the session runs, so the
    // shell repaints in place rather than when the pane is next opened.
    const retheming = onThemeChange(() => {
      term.options.theme = kastenTheme();
    });

    return () => {
      cancelAnimationFrame(painted);
      retheming();
      watching.disconnect();
      resizing.dispose();
      typing.dispose();
      // Our own close is not news, and the terminal it would write to is
      // disposed a line below.
      socket.onclose = null;
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
      // Ctrl was armed for this shell, and the pane may be about to hold
      // another: the route swaps `session` without remounting.
      ctrlRef.current = false;
      setCtrl(false);
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

  // The row is gone with the finger, and Ctrl with nothing showing it armed
  // would turn the next letter into a surprise.
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
    // `input` and not the socket: it fires `onData`, so the key takes the path
    // a typed one takes and scrolls the terminal to the prompt.
    term.input(bytes);
  }

  // No border of its own: `pane-layout.tsx` draws that already. No room made
  // for an on-screen keyboard either: the route's frame shrinks above one, the
  // host with it, and the `ResizeObserver` refits.
  return (
    <div className="flex h-full w-full flex-col">
      <div ref={host} className="min-h-0 w-full flex-1" />
      {coarse && <TerminalKeys ctrl={ctrl} onKey={onKey} />}
    </div>
  );
}
