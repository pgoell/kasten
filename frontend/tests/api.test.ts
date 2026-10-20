import { readFileSync } from "node:fs";
import path from "node:path";
import { fetchBook, importAnki, importAnkiLink, UPLOAD_LIMIT_BYTES, uploadAsset } from "@/lib/api";

const FILES = readFileSync(
  path.join(import.meta.dirname, "../../backend/src/kasten_backend/files.py"),
  "utf8",
);

/** The backend's own cap, read off the module that enforces it. */
function backendCap(): number {
  const found = FILES.match(/^UPLOAD_LIMIT_BYTES = ([\d *]+)$/m)?.[1];
  if (found === undefined) throw new Error("files.py carries no UPLOAD_LIMIT_BYTES");
  return found.split("*").reduce((total, factor) => total * Number(factor), 1);
}

/** One piece, the most a single request carries. */
const PIECE = 10 * 1024 * 1024;

/**
 * The backend behind the upload routes, and every request sent to it in order.
 *
 * Each entry of `pieces` answers one PUT in turn: "drop" as a lost connection,
 * a number as that status. Past the last entry a PUT lands. A request reads as
 * its method, its URL and what it carried.
 */
function uploads(pieces: ("drop" | number)[] = []) {
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body;
      const carried =
        body instanceof Blob ? ` ${body.size} bytes` : typeof body === "string" ? ` ${body}` : "";
      sent.push(`${init?.method} ${url}${carried}`);
      if (url === "/api/uploads") {
        return { ok: true, status: 201, json: async () => ({ id: "u1" }) };
      }
      const answer = init?.method === "PUT" ? pieces.shift() : undefined;
      // What `fetch` itself throws when the connection drops.
      if (answer === "drop") throw new TypeError("Failed to fetch");
      if (answer !== undefined && answer >= 300) {
        return {
          ok: false,
          status: answer,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ detail: `The backend answered ${answer}` }),
        };
      }
      return { ok: true, status: 201, json: async () => ({}) };
    }),
  );
  return sent;
}

describe("fetchBook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** The vault answering with one file, named the way the route names it. */
  function answering(named: string, bytes = new Blob(["book"])) {
    return vi.fn().mockResolvedValue({
      ok: true,
      // Encoded, because a header is latin-1 on the wire. The backend spells
      // it this way and this is the other half of that one rule.
      headers: new Headers({ "X-Book-Path": encodeURIComponent(named) }),
      blob: async () => bytes,
    });
  }

  it("asks the vault what sits beside the note, percent encoded", async () => {
    // The note's path and not the file's: two suffixes answer to the pair now,
    // and which of them is there is the vault's answer rather than a guess
    // this side could make without spending a 404 on every pdf.
    const fetching = answering("20 Literature/DDIA.epub");
    vi.stubGlobal("fetch", fetching);

    await fetchBook("20 Literature/DDIA.md");

    expect(fetching).toHaveBeenCalledWith("/api/books/20%20Literature%2FDDIA.md");
  });

  it("hands back the file the answer named, with its bytes", async () => {
    const bytes = new Blob(["book"]);
    vi.stubGlobal("fetch", answering("20 Literature/DDIA.pdf", bytes));

    await expect(fetchBook("20 Literature/DDIA.md")).resolves.toEqual({
      path: "20 Literature/DDIA.pdf",
      blob: bytes,
    });
  });

  it("decodes a name the header could not carry as it stands", async () => {
    // The case the encoding exists for: a vault holds notes called
    // `Grundzüge`, and a header carrying that byte for byte is not latin-1.
    vi.stubGlobal("fetch", answering("00 Inbox/02 Documents/Grundzüge.pdf"));

    await expect(fetchBook("00 Inbox/02 Documents/Grundzüge.md")).resolves.toMatchObject({
      path: "00 Inbox/02 Documents/Grundzüge.pdf",
    });
  });

  it("refuses an answer that names no file", async () => {
    // A backend that changed under this one. It reads as no book rather than
    // as a book called nothing, which is what the reader would download and
    // put in its own failure message.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), blob: async () => new Blob() }),
    );

    await expect(fetchBook("20 Literature/DDIA.md")).rejects.toThrow("without naming the file");
  });

  it("says what the vault answered when it refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchBook("gone.md")).rejects.toThrow("404");
  });
});

describe("uploadAsset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the file as the raw body, to the encoded path", async () => {
    const file = new Blob(["a book"]);
    const fetching = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetching);

    await uploadAsset("books/DDIA.epub", file);

    // The same `Blob` and not a `FormData` around it: one file and no fields,
    // so nothing has to parse a boundary at either end.
    expect(fetching).toHaveBeenCalledWith("/api/assets/books%2FDDIA.epub", {
      method: "POST",
      body: file,
    });
  });

  it("carries the vault's own sentence out of a refusal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ detail: "A book is already there" }),
      }),
    );

    await expect(uploadAsset("books/DDIA.epub", new Blob(["a"]))).rejects.toThrow(
      "A book is already there",
    );
  });

  it("#521 A6 names the limit when a 413 comes back without JSON, which is Cloudflare's", async () => {
    const json = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        headers: new Headers({ "content-type": "text/html" }),
        json,
      }),
    );

    const failed = await uploadAsset("books/DDIA.epub", new Blob(["a"])).catch(
      (error: unknown) => error,
    );

    // An oversize body never reaches kasten in production: Cloudflare refuses
    // it first, with an HTML page a parse would throw on.
    expect(json).not.toHaveBeenCalled();
    expect(failed).toEqual(
      new Error(
        "That file is over the upload limit of a proxy in front of kasten (100MB per request)",
      ),
    );
  });

  it("#521 A3 sends a file over one piece in parts and finishes it by its id", async () => {
    const sent = uploads();

    await uploadAsset("books/DDIA.pdf", new Blob([new Uint8Array(PIECE)]));
    await uploadAsset("books/DDIA.pdf", new Blob([new Uint8Array(PIECE + 1)]));

    expect(sent).toEqual([
      `POST /api/assets/books%2FDDIA.pdf ${PIECE} bytes`,
      `POST /api/uploads {"size":${PIECE + 1}}`,
      `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      "PUT /api/uploads/u1/1 1 bytes",
      "POST /api/assets/books%2FDDIA.pdf?upload=u1",
    ]);
  });

  it("#521 A8 sends a piece again after a lost connection or a 502, and only that piece", async () => {
    const sent = uploads(["drop", 204, 502]);

    await uploadAsset("books/DDIA.pdf", new Blob([new Uint8Array(PIECE + 1)]));

    expect(sent).toEqual([
      `POST /api/uploads {"size":${PIECE + 1}}`,
      `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      "PUT /api/uploads/u1/1 1 bytes",
      "PUT /api/uploads/u1/1 1 bytes",
      "POST /api/assets/books%2FDDIA.pdf?upload=u1",
    ]);
  });

  it("#521 A8 gives up on a piece after three tries, and at once on a 4xx", async () => {
    const dropped = uploads(["drop", "drop", "drop"]);
    const lost = await uploadAsset("books/DDIA.pdf", new Blob([new Uint8Array(PIECE + 1)])).catch(
      (error: unknown) => error,
    );
    const refused = uploads([409]);
    const turned = await uploadAsset("books/DDIA.pdf", new Blob([new Uint8Array(PIECE + 1)])).catch(
      (error: unknown) => error,
    );

    expect({ lost, dropped, turned, refused }).toEqual({
      lost: new TypeError("Failed to fetch"),
      dropped: [
        `POST /api/uploads {"size":${PIECE + 1}}`,
        `PUT /api/uploads/u1/0 ${PIECE} bytes`,
        `PUT /api/uploads/u1/0 ${PIECE} bytes`,
        `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      ],
      turned: new Error("The backend answered 409"),
      refused: [`POST /api/uploads {"size":${PIECE + 1}}`, `PUT /api/uploads/u1/0 ${PIECE} bytes`],
    });
  });
});

describe("importAnki", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for Anki's schedule only when told to", async () => {
    const posting = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", posting);
    const deck = new Blob(["apkg"]);

    await importAnki(deck, false);
    expect(posting).toHaveBeenLastCalledWith("/api/anki", { method: "POST", body: deck });

    await importAnki(deck, true);
    expect(posting).toHaveBeenLastCalledWith("/api/anki?carry=true", {
      method: "POST",
      body: deck,
    });
  });

  it("#521 A3 sends a deck over one piece in parts and imports it by its id", async () => {
    const sent = uploads();

    await importAnki(new Blob([new Uint8Array(PIECE)]), false);
    await importAnki(new Blob([new Uint8Array(PIECE + 1)]), true);

    expect(sent).toEqual([
      `POST /api/anki ${PIECE} bytes`,
      `POST /api/uploads {"size":${PIECE + 1}}`,
      `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      "PUT /api/uploads/u1/1 1 bytes",
      "POST /api/anki?carry=true&upload=u1",
    ]);
  });
});

describe("importAnkiLink", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const LINK = "https://ankiweb.net/shared/info/1104981491";

  it("A2 posts the link as JSON, asking for Anki's schedule only when told to", async () => {
    const posting = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", posting);
    const sent = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: LINK }),
    };

    await importAnkiLink(LINK, false);
    expect(posting).toHaveBeenLastCalledWith("/api/anki/link", sent);

    await importAnkiLink(LINK, true);
    expect(posting).toHaveBeenLastCalledWith("/api/anki/link?carry=true", sent);
  });

  it("A7 carries the backend's sentence out of a refusal word for word", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ detail: "That page holds no shared deck" }),
      }),
    );

    await expect(importAnkiLink(LINK, false)).rejects.toThrow(
      new Error("That page holds no shared deck"),
    );
  });
});

describe("the size cap", () => {
  // Two copies of one number, pinned the way `csp.test.ts` pins the policy.
  // An inequality and not an equality: a client stricter than the server is
  // merely cautious, and a client that lets through what the server refuses
  // turns a 413 into a network error nobody can read.
  it("never lets through a file the backend would refuse", () => {
    expect(UPLOAD_LIMIT_BYTES).toBeLessThanOrEqual(backendCap());
  });
});
