import { readFileSync } from "node:fs";
import path from "node:path";
import { importAnki, importAnkiLink } from "@/lib/anki-import";
import { fetchBook, UPLOAD_LIMIT_BYTES, uploadAsset } from "@/lib/api";

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

/** One answer from the backend: a lost connection, a status, or a status with its body. */
type Reply = "drop" | number | { status: number; body: unknown };

/**
 * The backend behind the upload routes, and every request sent to it in order.
 *
 * `pieces` answers each PUT in turn, `finishes` each POST that is not an upload,
 * and `polls` each GET of an import: "drop" as a lost connection, a number as
 * that status, an object as that status with that body. Past the end of a list
 * the request lands. A request reads as its method, its URL and what it carried.
 */
function uploads(pieces: Reply[] = [], finishes: Reply[] = [], polls: Reply[] = []) {
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body;
      const carried =
        body instanceof Blob ? ` ${body.size} bytes` : typeof body === "string" ? ` ${body}` : "";
      sent.push(`${init?.method ?? "GET"} ${url}${carried}`);
      if (url === "/api/uploads") {
        return { ok: true, status: 201, json: async () => ({ id: "u1" }) };
      }
      if (init?.method === "PUT") return reply(pieces.shift());
      if (url.startsWith("/api/anki/imports/")) return reply(polls.shift());
      return init?.method === "POST" ? reply(finishes.shift()) : reply(undefined);
    }),
  );
  return sent;
}

/** What `fetch` answers with for one `Reply`, which is the answer to a request that landed when none. */
function reply(answer: Reply | undefined) {
  // What `fetch` itself throws when the connection drops.
  if (answer === "drop") throw new TypeError("Failed to fetch");
  if (typeof answer === "object") {
    return {
      ok: answer.status < 300,
      status: answer.status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => answer.body,
    };
  }
  // A bare 5xx is Cloudflare's HTML page, which names no reason.
  if (answer !== undefined && answer >= 500) {
    return {
      ok: false,
      status: answer,
      headers: new Headers({ "content-type": "text/html" }),
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    };
  }
  if (answer !== undefined && answer >= 300) {
    return {
      ok: false,
      status: answer,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ detail: `The backend answered ${answer}` }),
    };
  }
  return { ok: true, status: 201, json: async () => ({}) };
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
    vi.useRealTimers();
  });

  /** The counts a deck that landed reports, the same ones the summary line is built from. */
  const LANDED = {
    notes: ["Anki/AWS.md"],
    cards: 120,
    media: 2,
    added: 5,
    updated: 3,
    kept: 110,
    removed: 2,
  };

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

  it("#688 a finish that answers 202 polls until the import reports its counts", async () => {
    vi.useFakeTimers();
    const sent = uploads(
      [],
      [{ status: 202, body: { upload: "u1" } }],
      [
        { status: 202, body: { upload: "u1" } },
        { status: 200, body: LANDED },
      ],
    );

    const done = importAnki(new Blob(["apkg"]), false);
    await vi.runAllTimersAsync();

    await expect(done).resolves.toEqual(LANDED);
    expect(sent).toEqual([
      "POST /api/anki 4 bytes",
      "GET /api/anki/imports/u1",
      "GET /api/anki/imports/u1",
    ]);
  });

  it("#688 a polled import that was refused rejects with the backend's sentence", async () => {
    vi.useFakeTimers();
    uploads(
      [],
      [{ status: 202, body: { upload: "u1" } }],
      [{ status: 422, body: { detail: "That page holds no shared deck" } }],
    );

    const done = importAnki(new Blob(["apkg"]), false).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await done).toEqual(new Error("That page holds no shared deck"));
  });

  it("#688 a polled import the backend forgot rejects with a sentence, not a stuck line", async () => {
    vi.useFakeTimers();
    const sentence = "No such import. The backend may have restarted: import the file again.";
    uploads(
      [],
      [{ status: 202, body: { upload: "u1" } }],
      [{ status: 404, body: { detail: sentence } }],
    );

    const done = importAnki(new Blob(["apkg"]), false).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await done).toEqual(new Error(sentence));
  });

  it("#688 a polled import that failed rejects with its reason, not a lost touch", async () => {
    vi.useFakeTimers();
    const sent = uploads(
      [],
      [{ status: 202, body: { upload: "u1" } }],
      [{ status: 500, body: { detail: "The import failed: The disk is full" } }],
    );

    const done = importAnki(new Blob(["apkg"]), false).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await done).toEqual(new Error("The import failed: The disk is full"));
    expect(sent).toHaveLength(2);
  });

  it("#688 a poll that drops or gets a 5xx tries again and then gives up with a sentence", async () => {
    vi.useFakeTimers();
    // Two failures and then an answer: the import is still there, so the line waits on.
    const recovering = uploads(
      [],
      [{ status: 202, body: { upload: "u1" } }],
      ["drop", 502, { status: 200, body: LANDED }],
    );
    const recovered = importAnki(new Blob(["apkg"]), false);
    await vi.runAllTimersAsync();
    await expect(recovered).resolves.toEqual(LANDED);
    expect(recovering).toHaveLength(4);

    // Five failures in a row and the line gives up, once, rather than polling on.
    const failing = uploads(
      [],
      [{ status: 202, body: { upload: "u1" } }],
      ["drop", 502, "drop", 503, "drop", { status: 200, body: LANDED }],
    );
    const lost = importAnki(new Blob(["apkg"]), false).catch((error: unknown) => error);
    await vi.runAllTimersAsync();

    expect(await lost).toEqual(
      new Error("Lost touch with the import; reload the deck list to see whether it landed"),
    );
    expect(failing).toHaveLength(6);
  });

  it("#688 importing the same file after a failure finishes the kept upload without sending it again", async () => {
    const deck = new File([new Uint8Array(PIECE + 1)], "kept-refused.apkg", { lastModified: 1 });
    const sent = uploads(
      [],
      [
        { status: 422, body: { detail: "That deck has no cards" } },
        { status: 201, body: LANDED },
      ],
    );

    await expect(importAnki(deck, false)).rejects.toThrow("That deck has no cards");
    await expect(importAnki(deck, false)).resolves.toEqual(LANDED);

    expect(sent).toEqual([
      `POST /api/uploads {"size":${PIECE + 1}}`,
      `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      "PUT /api/uploads/u1/1 1 bytes",
      "POST /api/anki?upload=u1",
      "POST /api/anki?upload=u1",
    ]);
  });

  it("#688 a kept upload the backend no longer has is sent again in parts", async () => {
    const deck = new File([new Uint8Array(PIECE + 1)], "kept-gone.apkg", { lastModified: 2 });
    const sent = uploads(
      [],
      [
        { status: 422, body: { detail: "That deck has no cards" } },
        { status: 404, body: { detail: "No such upload" } },
        { status: 201, body: LANDED },
      ],
    );

    await expect(importAnki(deck, false)).rejects.toThrow("That deck has no cards");
    await expect(importAnki(deck, false)).resolves.toEqual(LANDED);

    expect(sent).toEqual([
      `POST /api/uploads {"size":${PIECE + 1}}`,
      `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      "PUT /api/uploads/u1/1 1 bytes",
      "POST /api/anki?upload=u1",
      "POST /api/anki?upload=u1",
      `POST /api/uploads {"size":${PIECE + 1}}`,
      `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      "PUT /api/uploads/u1/1 1 bytes",
      "POST /api/anki?upload=u1",
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
