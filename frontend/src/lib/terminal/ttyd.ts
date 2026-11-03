/**
 * ttyd's wire protocol, encoded and decoded only here. Pure: no socket, no xterm, no DOM.
 * Every frame is one command byte from ttyd's `src/server.h`, then its payload.
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
 * The first frame, which ttyd waits for. The JSON is the whole frame: `{` is the command byte.
 * The token is empty because oauth2-proxy guards the terminal, not ttyd.
 */
export function encodeAuth(columns: number, rows: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify({ AuthToken: "", columns, rows }));
}

/** Keystrokes, straight through. UTF-8, so a typed `é` reaches the PTY whole. */
export function encodeInput(data: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(INPUT + data);
}

/** Window size for the PTY. Numbers, not strings: ttyd's `uint16` parse drops quoted ones. */
export function encodeResize(columns: number, rows: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(RESIZE + JSON.stringify({ columns, rows }));
}

export type ServerMessage =
  | { kind: "output"; bytes: Uint8Array }
  | { kind: "title"; text: string }
  | { kind: "preferences"; text: string }
  | { kind: "unknown"; opcode: string };

/**
 * Output stays bytes: a character can split across WebSocket frames, and xterm's decoder joins it.
 * A `TextDecoder` per frame would print replacement characters.
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
      // Unknown frames must not tear down a working terminal.
      return { kind: "unknown", opcode };
  }
}

/**
 * What the pane prints once the socket is gone. It goes in the terminal, the pane's only output, so
 * `opened` separates a failed connect (no ttyd, or a login redirect) from a shell that ended.
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
  // A fresh line first, so it never lands mid-prompt.
  return `\r\n\x1b[2;31m${lines.join("\r\n")}\x1b[0m\r\n`;
}

/**
 * The session name rides the WebSocket query: ttyd's `-a` reads `arg=` into its argv.
 * A name in the page URL reaches nothing.
 */
export function terminalUrl(session: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/term/ws?arg=${encodeURIComponent(session)}`;
}
