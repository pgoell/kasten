import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReviewDecks } from "@/components/review-decks";
import * as anki from "@/lib/anki-import";
import * as api from "@/lib/api";
import { HITS, seededClient, serveNotes } from "./review-pane-fixture";

// The polled import runs on fake timers; every test after it gets the real ones back.
afterEach(() => {
  vi.useRealTimers();
});

describe("ReviewDecks reading the deck notes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * With `hits` the cache holds them before mount; without, the decks wait on
   * the reads, which is what the failing-note test is about.
   */
  function renderDecks(hits?: api.SearchHit[], archive?: boolean) {
    const client = hits
      ? seededClient(hits, archive)
      : new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewDecks onPick={vi.fn()} onParked={vi.fn()} archive={archive} />
      </QueryClientProvider>,
    );
  }

  it("counts the other decks when one note fails to read", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    // No backend here, so the defaults read would retry a network error for a minute.
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
    vi.spyOn(api, "fetchNote").mockImplementation((path) =>
      path === "a.md"
        ? Promise.reject(new Error("GET /api/files/a.md failed with 500"))
        : Promise.resolve(path === "b.md" ? "#flashcards/beta\n\nc::d\n" : "#flashcards/zeta\n"),
    );
    renderDecks();

    expect(await screen.findByRole("button", { name: /^beta/ })).toHaveTextContent("1 new");
    expect(screen.queryByRole("button", { name: /^alpha/ })).not.toBeInTheDocument();
    expect(screen.getByText(/to go today/).textContent).toBe("1 card to go today in 1 deck.");
  });

  it("asks the scan to skip the archive, or to walk it", async () => {
    const cards = vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);

    // The seeded scan is stale at once, so the mount still asks for it.
    renderDecks(HITS);
    screen.getByRole("button", { name: /^alpha/ });
    expect(cards).toHaveBeenLastCalledWith(false);

    cleanup();
    renderDecks(HITS, true);
    screen.getByRole("button", { name: /^alpha/ });
    expect(cards).toHaveBeenLastCalledWith(true);
  });

  it("imports without Anki's schedule unless asked, and counts what the merge did", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    const imported = vi.spyOn(anki, "importAnki").mockResolvedValue({
      notes: ["Anki/AWS.md"],
      cards: 120,
      media: 2,
      added: 5,
      updated: 3,
      kept: 110,
      removed: 2,
    });
    renderDecks(HITS);
    screen.getByRole("button", { name: /^alpha/ });
    const deck = new File(["apkg"], "aws.apkg");
    const carry = screen.getByRole("checkbox", { name: "Carry Anki's schedule" });

    expect(carry).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Import an Anki deck"), { target: { files: [deck] } });
    expect(imported).toHaveBeenLastCalledWith(deck, false, expect.any(Function));
    expect(
      await screen.findByText(
        "1 deck, 120 cards: 5 added, 3 updated, 110 kept, 2 removed in Anki, 2 media files",
      ),
    ).toBeInTheDocument();

    fireEvent.click(carry);
    fireEvent.change(screen.getByLabelText("Import an Anki deck"), { target: { files: [deck] } });
    expect(imported).toHaveBeenLastCalledWith(deck, true, expect.any(Function));
  });

  /**
   * A backend taking a deck in parts whose finish answers 202, and whose polls answer `polls` in turn.
   *
   * Nothing is mocked above `fetch`, so the import runs through `api.ts` and its
   * poll, which waits on fake timers.
   */
  function parts(polls: { status: number; body: unknown }[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const json = (status: number, body: unknown) => ({
          ok: status < 300,
          status,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => body,
        });
        if (url === "/api/uploads") return json(201, { id: "u1" });
        if (init?.method === "PUT") return json(201, {});
        if (url === "/api/anki?upload=u1") return json(202, { upload: "u1" });
        const poll = polls.shift();
        if (poll === undefined) throw new Error(`unexpected ${init?.method} ${url}`);
        return json(poll.status, poll.body);
      }),
    );
  }

  /** Let the import's poll timer fire, with the promises it waits on settled. */
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  function pickBigDeck() {
    render(
      <QueryClientProvider client={seededClient(HITS)}>
        <ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /^alpha/ });
    // Over one 10 MiB piece, so the deck goes up in parts and the finish is a 202 to poll.
    fireEvent.change(screen.getByLabelText("Import an Anki deck"), {
      target: { files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "polled.apkg")] },
    });
  }

  it("#688 the import line shows the polled outcome and refreshes the deck list", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    const client = seededClient(HITS);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    parts([
      { status: 202, body: { upload: "u1" } },
      {
        status: 200,
        body: {
          notes: ["Anki/AWS.md"],
          cards: 120,
          media: 0,
          added: 5,
          updated: 3,
          kept: 110,
          removed: 2,
        },
      },
    ]);
    render(
      <QueryClientProvider client={client}>
        <ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /^alpha/ });
    const cards = vi.mocked(api.fetchCards).mock.calls.length;
    fireEvent.change(screen.getByLabelText("Import an Anki deck"), {
      target: { files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "polled.apkg")] },
    });

    await tick(0);
    expect(screen.getByText("Importing…")).toBeInTheDocument();
    await tick(2000);
    expect(screen.getByText("Importing…")).toBeInTheDocument();
    await tick(2000);

    expect(
      screen.getByText("1 deck, 120 cards: 5 added, 3 updated, 110 kept, 2 removed in Anki"),
    ).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cards"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["files"] });
    expect(vi.mocked(api.fetchCards).mock.calls.length).toBeGreaterThan(cards);
  });

  it("#688 the import line shows the reason of a polled import that failed", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    parts([{ status: 500, body: { detail: "The import failed: The disk is full" } }]);
    pickBigDeck();

    await tick(0);
    await tick(2000);

    expect(screen.getByText("The import failed: The disk is full")).toBeInTheDocument();
  });

  it("#517 A5 the Anki import is a bordered button behind one Import entry", () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    const opened: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      opened.push(this);
    });
    renderDecks(HITS);
    screen.getByRole("button", { name: /^alpha/ });

    expect(screen.getByLabelText("a link to an Anki deck")).not.toBeVisible();
    fireEvent.click(screen.getByText("Import an Anki deck"));
    expect(screen.getByLabelText("a link to an Anki deck")).toBeVisible();

    const button = screen.getByRole("button", { name: "Choose an .apkg file" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveClass("border", "min-h-11");
    fireEvent.click(button);
    expect(opened).toEqual([screen.getByLabelText("Import an Anki deck")]);
  });

  it("opens the deck picker once the key that pressed the button is up", () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    renderDecks(HITS);
    screen.getByRole("button", { name: /^alpha/ });
    fireEvent.click(screen.getByText("Import an Anki deck"));
    const button = screen.getByRole("button", { name: "Choose an .apkg file" });
    const click = vi
      .spyOn(screen.getByLabelText("Import an Anki deck"), "click")
      .mockImplementation(() => {});

    // Enter fires the button's click inside the keydown, with the key still down.
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();

    fireEvent.keyUp(button, { key: "Enter" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("#517 I8 closing and opening Import keeps the last import's line and the tick", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    vi.spyOn(anki, "importAnki").mockResolvedValue({
      notes: ["Anki/AWS.md"],
      cards: 120,
      media: 0,
      added: 5,
      updated: 3,
      kept: 110,
      removed: 2,
    });
    renderDecks(HITS);
    screen.getByRole("button", { name: /^alpha/ });
    const carry = screen.getByRole("checkbox", { name: "Carry Anki's schedule" });

    expect(carry).not.toBeVisible();
    const entry = screen.getByText("Import an Anki deck");
    fireEvent.click(entry);
    fireEvent.click(carry);
    fireEvent.change(screen.getByLabelText("Import an Anki deck"), {
      target: { files: [new File(["apkg"], "aws.apkg")] },
    });
    const line = await screen.findByText(
      "1 deck, 120 cards: 5 added, 3 updated, 110 kept, 2 removed in Anki",
    );

    fireEvent.click(entry);
    expect(line).not.toBeVisible();
    fireEvent.click(entry);
    expect(line).toBeVisible();
    expect(carry).toBeChecked();
  });
});

describe("ReviewDecks importing a large deck (#521)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function pickDeck(deck: File) {
    render(
      <QueryClientProvider client={seededClient(HITS)}>
        <ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /^alpha/ });
    fireEvent.change(screen.getByLabelText("Import an Anki deck"), { target: { files: [deck] } });
  }

  it("#521 A4 the import line says how much is up, then that the deck is importing", () => {
    let progress: ((sent: number, total: number) => void) | undefined;
    vi.spyOn(anki, "importAnki").mockImplementation((_file, _carry, onProgress) => {
      progress = onProgress;
      return new Promise(() => {});
    });
    pickDeck(new File(["apkg"], "big.apkg"));

    const lines: (string | null | undefined)[] = [];
    // Floored: one byte short of the whole file is not yet 100%.
    for (const [sent, total] of [
      [4, 10],
      [10485760, 10485761],
      [10, 10],
    ] as const) {
      act(() => progress?.(sent, total));
      lines.push(screen.queryByText(/^(Uploading|Importing)/)?.textContent);
    }

    expect(lines).toEqual(["Uploading 40%…", "Uploading 99%…", "Importing…"]);
  });

  it("#521 I8 a piece refused for good shows the backend's sentence on the import line", async () => {
    const detail = "That piece would pass the size the upload declared";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/uploads") {
          return { ok: true, status: 201, json: async () => ({ id: "u1" }) };
        }
        if (init?.method === "PUT") {
          return {
            ok: false,
            status: 413,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ detail }),
          };
        }
        // A whole-file POST, which a large deck must not be sent as, lands.
        return {
          ok: true,
          status: 200,
          json: async () => ({
            notes: [],
            cards: 0,
            media: 0,
            added: 0,
            updated: 0,
            kept: 0,
            removed: 0,
          }),
        };
      }),
    );

    pickDeck(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.apkg"));

    expect((await screen.findByText(detail)).textContent).toBe(detail);
  });
});
