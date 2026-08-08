import { decodeServer, encodeAuth, encodeInput, encodeResize } from "@/lib/ttyd";

/** The payload after the command byte, as text. */
function payload(frame: Uint8Array): string {
  return new TextDecoder().decode(frame.slice(1));
}

/** A server frame, built the way ttyd builds one: a command byte then bytes. */
function serverFrame(opcode: string, body: Uint8Array | string): ArrayBuffer {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const frame = new Uint8Array(1 + bytes.length);
  frame[0] = opcode.charCodeAt(0);
  frame.set(bytes, 1);
  return frame.buffer as ArrayBuffer;
}

describe("what the client sends", () => {
  it("opens with the auth frame, whose opening brace is the command byte", () => {
    const frame = encodeAuth(80, 24);

    // ttyd reads `{` as JSON_DATA, so the JSON is the whole frame. A separate
    // prefix byte would leave the server parsing `{{"AuthToken"...`.
    expect(frame[0]).toBe(0x7b);
    expect(new TextDecoder().decode(frame)).toBe('{"AuthToken":"","columns":80,"rows":24}');
  });

  it("sends a keystroke under the input command", () => {
    const frame = encodeInput("ls\r");

    expect(String.fromCharCode(frame[0] as number)).toBe("0");
    expect(payload(frame)).toBe("ls\r");
  });

  it("sends input as UTF-8 rather than a byte per character", () => {
    // Two bytes for the character and one for the command byte. A charCode per
    // character would send two in all, and the shell would read a broken one.
    expect(encodeInput("é")).toHaveLength(3);
  });

  it("sends a resize as numbers, which is what ttyd parses them as", () => {
    const frame = encodeResize(120, 40);

    expect(String.fromCharCode(frame[0] as number)).toBe("1");
    expect(payload(frame)).toBe('{"columns":120,"rows":40}');
    // Spelled out as well as compared, because this is the part that fails
    // quietly: ttyd's `parse_window_size` reads both as `uint16` and drops a
    // quoted number, leaving the PTY at whatever size it started on.
    const size = JSON.parse(payload(frame)) as { columns: unknown; rows: unknown };
    expect(typeof size.columns).toBe("number");
    expect(typeof size.rows).toBe("number");
  });
});

describe("what the server sends", () => {
  it("reads output back as the bytes it arrived as", () => {
    const bytes = new Uint8Array([0x68, 0x69, 0x0a]);

    expect(decodeServer(serverFrame("0", bytes))).toEqual({ kind: "output", bytes });
  });

  it("reads a window title and a preferences blob as text", () => {
    expect(decodeServer(serverFrame("1", "kasten"))).toEqual({ kind: "title", text: "kasten" });
    expect(decodeServer(serverFrame("2", "{}"))).toEqual({ kind: "preferences", text: "{}" });
  });

  it("names an opcode it does not know rather than throwing", () => {
    // A frame nobody understands is not a reason to tear down the terminal.
    expect(decodeServer(serverFrame("9", ""))).toEqual({ kind: "unknown", opcode: "9" });
  });

  it("hands back a character split across two frames in one piece", () => {
    // The property the whole codec is shaped around: output is never decoded
    // here, so xterm's own long-lived UTF-8 decoder reassembles a multi-byte
    // character whose bytes arrived in different WebSocket messages. Decoding
    // per frame would turn each half into a replacement character.
    const character = new TextEncoder().encode("é");
    const head = character.slice(0, 1);
    const tail = character.slice(1);

    const first = decodeServer(serverFrame("0", head));
    const second = decodeServer(serverFrame("0", tail));

    expect(first.kind).toBe("output");
    expect(second.kind).toBe("output");
    // Compared as plain arrays: `TextEncoder` here answers with a typed array
    // from another realm, which `toEqual` calls different from an identical one.
    const joined = [
      ...(first as { bytes: Uint8Array }).bytes,
      ...(second as { bytes: Uint8Array }).bytes,
    ];
    expect(joined).toEqual([...character]);
  });
});
