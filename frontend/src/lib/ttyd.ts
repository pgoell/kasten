/**
 * ttyd's wire protocol, encoded and decoded here and nowhere else.
 *
 * Pure: no socket, no xterm, no DOM beyond `location`. `terminal-pane.tsx`
 * owns the socket and the terminal, and this owns what goes over the wire and
 * what the pane says when the wire goes, so both can be tested without
 * mounting anything.
 *
 * Every frame is one command character followed by its payload. The command
 * characters are ttyd's own, out of `src/server.h`.
 */

/** ttyd answers the upgrade only for this subprotocol. */
export const TTYD_SUBPROTOCOL = "tty";

const INPUT = "0";
const RESIZE = "1";

const OUTPUT = "0";
const TITLE = "1";
const PREFERENCES = "2";

const encoder = new TextEncoder();

/**
 * The first frame, which ttyd waits for before it starts the command.
 *
 * The opening brace is the JSON_DATA command byte, so the JSON is the whole
 * frame and nothing prefixes it. The token is empty because the terminal sits
 * behind oauth2-proxy: ttyd's own auth is not what is guarding this.
 */
export function encodeAuth(columns: number, rows: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify({ AuthToken: "", columns, rows }));
}

/** Keystrokes, straight through. UTF-8, so a typed `é` reaches the PTY whole. */
export function encodeInput(data: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(INPUT + data);
}

/**
 * Tell the PTY how big the window is.
 *
 * Numbers rather than strings: ttyd's `parse_window_size` reads them as
 * `uint16` and drops a quoted one.
 */
export function encodeResize(columns: number, rows: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(RESIZE + JSON.stringify({ columns, rows }));
}

export type ServerMessage =
  | { kind: "output"; bytes: Uint8Array }
  | { kind: "title"; text: string }
  | { kind: "preferences"; text: string }
  | { kind: "unknown"; opcode: string };

/**
 * One frame from the server.
 *
 * Terminal output comes back as bytes and is never decoded here. A multi-byte
 * character can be split across two WebSocket messages, and xterm holds one
 * long-lived UTF-8 decoder across `write()` calls that puts it back together.
 * A `TextDecoder` per frame would turn each half into a replacement character.
 */
export function decodeServer(frame: ArrayBuffer): ServerMessage {
  const bytes = new Uint8Array(frame);
  const opcode = String.fromCharCode(bytes[0] as number);
  const body = bytes.slice(1);

  switch (opcode) {
    case OUTPUT:
      return { kind: "output", bytes: body };
    case TITLE:
      return { kind: "title", text: new TextDecoder().decode(body) };
    case PREFERENCES:
      return { kind: "preferences", text: new TextDecoder().decode(body) };
    default:
      // Not a throw: a frame nobody here understands is no reason to tear down
      // a working terminal.
      return { kind: "unknown", opcode };
  }
}

/**
 * What the pane prints once the socket is gone, as bytes for `term.write`.
 *
 * Written into the terminal because the terminal is all the pane shows: without
 * it a socket that never opened leaves a black rectangle with a cursor, which
 * looks like a shell that is slow rather than one that is not there.
 *
 * `opened` splits the two cases. A socket that never opened met no ttyd: no
 * shell container, no `/term` route, or the login gate answering the upgrade
 * with a redirect, which the browser reports as a failed handshake and nothing
 * more specific. One that opened and then closed had a shell, which has ended.
 */
export function closedMessage(opened: boolean, code: number): string {
  const lines = opened
    ? [`The shell closed the connection (code ${code}).`]
    : [
        "Could not reach the shell at /term/ws.",
        "Check that the shell container is running, that the /term route is",
        "in place, and that you are logged in.",
      ];
  lines.push("Reopen the terminal to try again.");
  // Dim red, and a fresh line first so it never lands in the middle of a
  // prompt the shell had half drawn.
  return `\r\n\x1b[2;31m${lines.join("\r\n")}\x1b[0m\r\n`;
}

/**
 * Where ttyd sits behind Caddy, on the page's own origin.
 *
 * The session name goes on the WebSocket URL's query and not on the page's.
 * ttyd's `-a` reads `arg=` fragments off the upgrade request and appends them
 * to the server's own argv, so `?arg=notes` against `ttyd ... herdr --session`
 * runs `herdr --session notes`. A name in the page URL reaches nothing.
 */
export function terminalUrl(session: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/term/ws?arg=${encodeURIComponent(session)}`;
}
