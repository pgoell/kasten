import { readFileSync } from "node:fs";
import path from "node:path";
import { ASSET_LIMIT_BYTES, fetchBook, uploadAsset } from "@/lib/api";

const MAIN = readFileSync(
  path.join(import.meta.dirname, "../../backend/src/kasten_backend/main.py"),
  "utf8",
);

/** The backend's own cap, read off the module that enforces it. */
function backendCap(): number {
  const found = MAIN.match(/^ASSET_LIMIT_BYTES = ([\d *]+)$/m)?.[1];
  if (found === undefined) throw new Error("main.py carries no ASSET_LIMIT_BYTES");
  return found.split("*").reduce((total, factor) => total * Number(factor), 1);
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

  it("names the status when the answer is not JSON, which is Cloudflare's", async () => {
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

    await expect(uploadAsset("books/DDIA.epub", new Blob(["a"]))).rejects.toThrow(
      "POST /api/assets/books/DDIA.epub failed with 413",
    );
    // An oversize body never reaches kasten in production: Cloudflare refuses
    // it first, with an HTML page a parse would throw on.
    expect(json).not.toHaveBeenCalled();
  });
});

describe("the size cap", () => {
  // Two copies of one number, pinned the way `csp.test.ts` pins the policy.
  // An inequality and not an equality: a client stricter than the server is
  // merely cautious, and a client that lets through what the server refuses
  // turns a 413 into a network error nobody can read.
  it("never lets through a file the backend would refuse", () => {
    expect(ASSET_LIMIT_BYTES).toBeLessThanOrEqual(backendCap());
  });
});
