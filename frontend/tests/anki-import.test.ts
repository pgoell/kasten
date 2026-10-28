import { importAnki, importAnkiLink } from "@/lib/anki-import";
import { PIECE, uploads } from "./upload-backend-fixture";

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

  it("#688 a finish whose connection drops keeps the upload for the retry", async () => {
    const deck = new File([new Uint8Array(PIECE + 1)], "kept-dropped.apkg", { lastModified: 3 });
    const sent = uploads([], ["drop", { status: 201, body: LANDED }]);

    await expect(importAnki(deck, false)).rejects.toThrow("Failed to fetch");
    await expect(importAnki(deck, false)).resolves.toEqual(LANDED);

    expect(sent).toEqual([
      `POST /api/uploads {"size":${PIECE + 1}}`,
      `PUT /api/uploads/u1/0 ${PIECE} bytes`,
      "PUT /api/uploads/u1/1 1 bytes",
      "POST /api/anki?upload=u1",
      "POST /api/anki?upload=u1",
    ]);
  });

  it("#688 a poll answered 401 by the proxy counts as a lost ask, not the import's outcome", async () => {
    vi.useFakeTimers();
    // Two proxy 401s in a row are lost asks; the import then answers and that is the outcome.
    uploads(
      [],
      [{ status: 202, body: { upload: "u1" } }],
      [
        { status: 401, html: true },
        { status: 401, html: true },
        { status: 200, body: LANDED },
      ],
    );
    const landed = importAnki(new Blob(["apkg"]), false);
    await vi.runAllTimersAsync();
    await expect(landed).resolves.toEqual(LANDED);

    // Five of them in a row give up with the lost-touch sentence, not the proxy's status.
    uploads(
      [],
      [{ status: 202, body: { upload: "u1" } }],
      [1, 2, 3, 4, 5].map(() => ({ status: 401, html: true as const })),
    );
    const lost = importAnki(new Blob(["apkg"]), false).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await lost).toEqual(
      new Error("Lost touch with the import; reload the deck list to see whether it landed"),
    );
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
