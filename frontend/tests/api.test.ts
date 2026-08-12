import { readFileSync } from "node:fs";
import path from "node:path";
import { ASSET_LIMIT_BYTES, fetchBook, uploadBook } from "@/lib/api";

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

  it("asks for the book at the path, percent encoded", async () => {
    const bytes = new Blob(["book"]);
    const fetching = vi.fn().mockResolvedValue({ ok: true, blob: async () => bytes });
    vi.stubGlobal("fetch", fetching);

    await fetchBook("20 Literature/DDIA.epub");

    expect(fetching).toHaveBeenCalledWith("/api/assets/20%20Literature%2FDDIA.epub");
  });

  it("says what the vault answered when it refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchBook("gone.epub")).rejects.toThrow("404");
  });

  it("hands back the bytes when the vault has them", async () => {
    const bytes = new Blob(["book"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => bytes }));

    await expect(fetchBook("there.epub")).resolves.toBe(bytes);
  });
});

describe("uploadBook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the file as the raw body, to the encoded path", async () => {
    const file = new Blob(["a book"]);
    const fetching = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetching);

    await uploadBook("books/DDIA.epub", file);

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

    await expect(uploadBook("books/DDIA.epub", new Blob(["a"]))).rejects.toThrow(
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

    await expect(uploadBook("books/DDIA.epub", new Blob(["a"]))).rejects.toThrow(
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
