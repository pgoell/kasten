import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { decodeServer, encodeAuth, encodeInput, TTYD_SUBPROTOCOL, terminalUrl } from "@/lib/ttyd";

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

    const term = new Terminal({ cursorBlink: true });
    termRef.current = term;
    term.open(element);

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

    return () => {
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
