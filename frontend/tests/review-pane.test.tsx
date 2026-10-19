import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewDecks } from "@/components/review-decks";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import * as review from "@/lib/review";
import { deckNotes } from "@/lib/review";
import { shownCard } from "./review-card";
import { stubCommands } from "./stub-commands";

/** Two decks with cards waiting, and one with nothing, which cannot be picked. */
const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/alpha" },
  { path: "a.md", line: 2, text: "a::b" },
  { path: "b.md", line: 1, text: "#flashcards/beta" },
  { path: "b.md", line: 2, text: "c::d" },
  { path: "z.md", line: 1, text: "#flashcards/zeta" },
  { path: "z.md", line: 2, text: "e::f <!--SR:!2099-01-01,4,250-->" },
];

/**
 * Each note as the lines the scan found in it, which is what the overview reads.
 *
 * The counts come off the note, so the scan names the notes and this is the
 * text of each. A sitting's own `fetchNote` mock, set later, replaces it.
 */
function serveNotes(hits: api.SearchHit[]) {
  vi.spyOn(api, "fetchNote").mockImplementation((path) => Promise.resolve(noteOf(hits, path)));
}

function noteOf(hits: api.SearchHit[], path: string): string {
  return hits
    .filter((hit) => hit.path === path)
    .map((hit) => hit.text)
    .join("\n");
}

/**
 * A client already holding the scan and each deck note, as `renderPane` says why.
 *
 * Each note is the lines the scan found in it. A test whose `fetchNote` serves
 * fuller text gets that on the refetch at mount, which counts the same.
 */
function seededClient(hits: api.SearchHit[], archive = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["cards", archive], hits);
  for (const path of deckNotes(hits)) {
    client.setQueryData(["cards", "note", path], noteOf(hits, path));
  }
  return client;
}

/**
 * The pane on the deck overview, its decks drawn on the first render.
 *
 * The cache holds the scan and every deck note before the pane mounts. Left
 * empty, the rows wait on the scan, a `setTimeout` for the result to reach
 * React, a re-render that only then asks for the notes, those reads, another
 * `setTimeout` and another re-render, all inside `findBy`'s one second. That
 * chain ran out of the second on a loaded machine (#522). The reads still go
 * out, as a refetch on mount, and `ReviewDecks reading the deck notes` below
 * is where the wait itself is tested.
 */
async function renderPane() {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  serveNotes(HITS);
  const client = seededClient(HITS);
  render(
    <QueryClientProvider client={client}>
      <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  // `get` and not `find`: nothing is left to wait on.
  screen.getByRole("button", { name: /alpha/ });
  return screen.getByLabelText("review");
}

describe("ReviewPane keys on the deck overview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("walks the decks with j and k", async () => {
    const pane = await renderPane();

    fireEvent.keyDown(pane, { key: "j" });
    expect(document.activeElement).toHaveAttribute("data-deck", "alpha");

    fireEvent.keyDown(pane, { key: "j" });
    expect(document.activeElement).toHaveAttribute("data-deck", "beta");

    fireEvent.keyDown(pane, { key: "k" });
    expect(document.activeElement).toHaveAttribute("data-deck", "alpha");
  });

  it("stays on the first and the last rather than wrapping", async () => {
    const pane = await renderPane();

    fireEvent.keyDown(pane, { key: "k" });
    expect(document.activeElement).toHaveAttribute("data-deck", "alpha");

    // Past the end, and `zeta` has nothing waiting, so it is never landed on.
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    expect(document.activeElement).toHaveAttribute("data-deck", "beta");
  });

  it("starts the sitting on l", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue("#flashcards/beta\n\nc::d\n");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });

    expect(await shownCard()).toHaveTextContent("c");
  });

  it("keeps the keyboard after l starts the sitting", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue("#flashcards/beta\n\nc::d\n");

    // Twice, the way the test above does: the mocked note is `beta`'s.
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    await shownCard();

    // The deck row it pressed has gone with the overview, so without this the
    // focus falls to the body and no key of the sitting reaches the pane.
    expect(document.activeElement).toBe(pane);
  });
});

describe("ReviewPane on a nested deck", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const NESTED = [
    { path: "d.md", line: 1, text: "#flashcards/databases/postgres" },
    { path: "d.md", line: 2, text: "a::b" },
  ];

  // An unfold is kept in localStorage, so it is put back for whoever runs next.
  afterEach(() => localStorage.clear());

  it("draws the deck under its parent, called by its last part", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(NESTED);
    serveNotes(NESTED);
    const client = seededClient(NESTED);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    // A subdeck starts folded away (#517).
    fireEvent.click(screen.getByRole("button", { name: "unfold databases" }));

    const parent = screen.getByRole("button", { name: /^databases/ });
    const child = screen.getByRole("button", { name: /postgres/ });
    expect(parent).toHaveAttribute("data-deck", "databases");
    expect(child).toHaveAttribute("data-deck", "databases/postgres");
    expect(child.style.paddingLeft).toBe("1.5rem");
  });

  it("counts the card once in the header, not once per row above it", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(NESTED);
    serveNotes(NESTED);
    const client = seededClient(NESTED);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );

    // The parent, the subdeck being folded away (#517).
    screen.getByRole("button", { name: /^databases/ });

    expect(screen.getByText(/to go/).textContent).toBe("1 to go");
  });
});

describe("ReviewPane folding the deck list (#517)", () => {
  /** A parent with one due, one new and one parked card below it, and a deck after it. */
  const TREE = [
    { path: "d.md", line: 1, text: "#flashcards/databases/postgres" },
    { path: "d.md", line: 2, text: "a::b" },
    { path: "d.md", line: 3, text: "c::d <!--SR:!2000-01-01,4,250-->" },
    { path: "d.md", line: 4, text: "e::f !suspended" },
    { path: "z.md", line: 1, text: "#flashcards/zz" },
    { path: "z.md", line: 2, text: "g::h" },
  ];
  const FOLDS = "kasten.review.folds.1";

  // Folds and the vim setting live in localStorage, so each test starts bare.
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  function renderTree() {
    vi.spyOn(api, "fetchCards").mockResolvedValue(TREE);
    serveNotes(TREE);
    render(
      <QueryClientProvider client={seededClient(TREE)}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /^zz/ });
    return screen.getByLabelText("review");
  }

  const row = (name: string) => document.querySelector(`button[data-deck="${name}"]`);
  const press = (pane: HTMLElement, ...keys: string[]) => {
    for (const key of keys) fireEvent.keyDown(pane, { key });
  };

  it("#517 A1 folds a deck's subdecks behind a toggle, folded at first and kept per deck", () => {
    renderTree();

    expect(row("databases/postgres")).toBeNull();
    const toggle = screen.getByRole("button", { name: "unfold databases" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /fold zz/ })).toBeNull();

    fireEvent.click(toggle);
    expect(row("databases/postgres")).not.toBeNull();
    expect(screen.getByRole("button", { name: "fold databases" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // A remount reads the fold back.
    cleanup();
    renderTree();
    expect(row("databases/postgres")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "fold databases" }));
    expect(row("databases/postgres")).toBeNull();
  });

  it("#517 A2 a folded deck counts due, new and parked for everything under it", () => {
    renderTree();

    expect(row("databases/postgres")).toBeNull();
    const parent = row("databases");
    expect(parent).toHaveTextContent("1 due");
    expect(parent).toHaveTextContent("1 new");
    expect(parent).toHaveTextContent("1 parked");
  });

  it.each(["on", "off"])(
    "#517 A3 za folds and unfolds the deck under the cursor, vim %s",
    (vim) => {
      localStorage.setItem("kasten.vim", vim);
      localStorage.setItem(FOLDS, JSON.stringify(["databases"]));
      const pane = renderTree();

      press(pane, "j");
      expect(document.activeElement).toBe(row("databases"));
      press(pane, "z", "a");
      expect(row("databases/postgres")).toBeNull();
      expect(document.activeElement).toBe(row("databases"));

      press(pane, "z", "a");
      expect(row("databases/postgres")).not.toBeNull();
    },
  );

  it("#517 A3 a z followed by another key leaves that key its own", () => {
    localStorage.setItem(FOLDS, JSON.stringify(["databases"]));
    const pane = renderTree();

    press(pane, "j", "z", "j");
    expect(document.activeElement).toBe(row("databases/postgres"));
    press(pane, "k", "z", "a");
    expect(row("databases/postgres")).toBeNull();
  });

  it("#517 I4 za on a subdeck folds its parent and moves the cursor to the parent's row", () => {
    localStorage.setItem(FOLDS, JSON.stringify(["databases"]));
    const pane = renderTree();

    press(pane, "j", "j");
    expect(document.activeElement).toBe(row("databases/postgres"));
    press(pane, "z", "a");

    expect(row("databases/postgres")).toBeNull();
    expect(document.activeElement).toBe(row("databases"));
  });

  it("#517 I4 za on a subdeck under a parent with nothing to offer moves the cursor to its toggle", () => {
    // A parent disabled above a subdeck that can be sat, which a daily limit
    // on the parent alone makes and the counts of today's cards never do.
    vi.spyOn(review, "decksFrom").mockReturnValue([
      { name: "trivia", notes: ["d.md"], due: 0, fresh: 0, parked: 0, whole: false },
      { name: "trivia/geography", notes: ["d.md"], due: 0, fresh: 1, parked: 0, whole: false },
    ]);
    localStorage.setItem(FOLDS, JSON.stringify(["trivia"]));
    vi.spyOn(api, "fetchCards").mockResolvedValue(TREE);
    serveNotes(TREE);
    render(
      <QueryClientProvider client={seededClient(TREE)}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    const pane = screen.getByLabelText("review");

    press(pane, "j");
    expect(document.activeElement).toBe(row("trivia/geography"));
    press(pane, "z", "a");

    expect(row("trivia/geography")).toBeNull();
    expect(row("trivia")).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "unfold trivia" }));
  });

  it("#517 I5 j skips the rows a fold hides, and l on a folded deck sits all of it", async () => {
    const pane = renderTree();
    vi.spyOn(api, "fetchNote").mockResolvedValue(noteOf(TREE, "d.md"));

    press(pane, "j", "j");
    expect(document.activeElement).toBe(row("zz"));

    press(pane, "k", "l");
    expect(await shownCard()).toBeInTheDocument();
  });

  it("#517 I6 unreadable fold storage leaves everything below the top level folded", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    renderTree();

    expect(row("databases/postgres")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "unfold databases" }));
    expect(row("databases/postgres")).not.toBeNull();
  });
});

describe("ReviewPane leaving a sitting", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("goes back to the decks on h, leaving the pane open", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue("#flashcards/beta\n\nc::d\n");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    await shownCard();

    fireEvent.keyDown(pane, { key: "h" });

    expect(screen.queryByTestId("review-card")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /alpha/ })).toBeInTheDocument();
  });
});

describe("ReviewPane on a deck holding parked cards", () => {
  /** One deck with a live card beside a parked one, one deck of nothing else. */
  const PARKED = [
    { path: "a.md", line: 1, text: "#flashcards/alpha" },
    { path: "a.md", line: 2, text: "a::b" },
    { path: "a.md", line: 3, text: "c::d !suspended" },
    { path: "b.md", line: 1, text: "#flashcards/beta" },
    { path: "b.md", line: 2, text: "e::f !suspended" },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function renderParked() {
    vi.spyOn(api, "fetchCards").mockResolvedValue(PARKED);
    serveNotes(PARKED);
    const client = seededClient(PARKED);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /alpha/ });
  }

  it("counts the parked cards in the header beside the ones to go", async () => {
    await renderParked();

    expect(screen.getByText(/to go/).textContent).toBe("1 to go");
    expect(screen.getByText("2 parked")).toBeInTheDocument();
  });

  it("says on the row how many of its cards are parked", async () => {
    await renderParked();

    expect(screen.getByRole("button", { name: /alpha/ })).toHaveTextContent("1 parked");
  });

  it("cannot sit a deck holding nothing but parked cards", async () => {
    await renderParked();

    expect(screen.getByRole("button", { name: /beta/ })).toBeDisabled();
  });
});

describe("ReviewPane suspending the card on screen", () => {
  const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parks it on s and shows the next one", async () => {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue(TWO);
    vi.spyOn(api, "saveNote").mockResolvedValue({ path: "b.md", content: TWO });

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    expect(await shownCard()).toHaveTextContent("c");

    fireEvent.keyDown(pane, { key: "s" });

    expect(screen.getByTestId("review-card")).toHaveTextContent("e");
  });
});

describe("ReviewPane replaying a card's sound", () => {
  const SOUNDED = "#flashcards/beta\n\nc ![](beta%20media/c.mp3)::d ![](beta%20media/d.mp3)\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("plays the side showing again on r, the front before the answer and the back after", async () => {
    // jsdom draws a media element and plays nothing, so the player is stubbed.
    // The source is read at the call: the session reuses one element.
    const sources: string[] = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      sources.push(this.src);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue(SOUNDED);

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    await shownCard();
    const played = () => [...sources];

    fireEvent.keyDown(pane, { key: "r" });
    expect(played().at(-1)).toMatch(/\/api\/assets\/beta%20media\/c\.mp3$/);

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "r" });
    expect(played().at(-1)).toMatch(/\/api\/assets\/beta%20media\/d\.mp3$/);
    expect(played().filter((src) => src.endsWith("d.mp3"))).toHaveLength(2);
  });
});

describe("ReviewPane on the parked screen", () => {
  const PARKED_HITS = [
    { path: "a.md", line: 1, text: "#flashcards/alpha" },
    { path: "a.md", line: 2, text: "a::b" },
    { path: "a.md", line: 3, text: "What is a VPC?::A private cloud !suspended" },
  ];
  const A = "#flashcards/alpha\na::b\nWhat is a VPC?::A private cloud !suspended\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function openParked() {
    vi.spyOn(api, "fetchCards").mockResolvedValue(PARKED_HITS);
    vi.spyOn(api, "fetchNote").mockResolvedValue(A);
    vi.spyOn(api, "saveNote").mockResolvedValue({ path: "a.md", content: A });
    const onOpen = vi.fn();
    const client = seededClient(PARKED_HITS);
    const { container } = render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={onOpen} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /alpha/ });
    const pane = screen.getByLabelText("review");
    fireEvent.keyDown(pane, { key: "p" });
    return { pane, container, onOpen };
  }

  it("opens the parked list on p, leaving the decks behind", async () => {
    const { container } = await openParked();

    expect(await screen.findByText("What is a VPC?")).toBeInTheDocument();
    // By the attribute, not the name: a parked row names its deck too.
    expect(container.querySelector("button[data-deck]")).toBeNull();
  });

  it("walks the parked rows with j rather than the decks", async () => {
    const { pane } = await openParked();
    await screen.findByText("What is a VPC?");

    fireEvent.keyDown(pane, { key: "j" });

    expect(document.activeElement).toHaveAttribute("data-parked", "a.md:1");
    expect(document.activeElement).not.toHaveAttribute("data-deck");
  });

  it("goes back to the decks on h", async () => {
    const { pane, container } = await openParked();
    await screen.findByText("What is a VPC?");

    fireEvent.keyDown(pane, { key: "h" });

    expect(await screen.findByRole("button", { name: /alpha/ })).toBeInTheDocument();
    expect(container.querySelector("button[data-deck]")).not.toBeNull();
  });

  it("puts the focused row back on u", async () => {
    const { pane } = await openParked();
    await screen.findByText("What is a VPC?");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "u" });

    expect(screen.queryByText("What is a VPC?")).not.toBeInTheDocument();
  });

  it("keeps the keyboard after putting a row back", async () => {
    const { pane } = await openParked();
    await screen.findByText("What is a VPC?");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "u" });

    // The row it was on has gone with it, so without this the focus falls to
    // the body and every key after `u` reaches nothing.
    expect(document.activeElement).toBe(pane);
    fireEvent.keyDown(pane, { key: "h" });
    expect(await screen.findByRole("button", { name: /alpha/ })).toBeInTheDocument();
  });

  it("opens the note the focused row is written in on o", async () => {
    const { pane, onOpen } = await openParked();
    await screen.findByText("What is a VPC?");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "o" });

    expect(onOpen).toHaveBeenCalledWith("a.md");
  });
});

describe("ReviewPane jotting a question mid-sitting", () => {
  const TWO = "#flashcards/beta\n\nc::d\n\ne::f\n";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function inSitting() {
    const pane = await renderPane();
    vi.spyOn(api, "fetchNote").mockResolvedValue(TWO);
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({ path: "b.md", content: TWO });

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    await shownCard();
    return { pane, saved };
  }

  it("opens the field on n and puts the cursor in it", async () => {
    const { pane } = await inSitting();

    fireEvent.keyDown(pane, { key: "n" });

    expect(document.activeElement).toBe(screen.getByLabelText("a new question"));
  });

  it("does not rate the card while a question is being typed", async () => {
    const { pane, saved } = await inSitting();
    fireEvent.keyDown(pane, { key: "n" });

    // The pane's own rating keys are live on the section this bubbles to.
    fireEvent.keyDown(screen.getByLabelText("a new question"), { key: "1" });

    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByTestId("review-card")).toHaveTextContent("c");
  });
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
    vi.spyOn(api, "fetchNote").mockImplementation((path) =>
      path === "a.md"
        ? Promise.reject(new Error("GET /api/files/a.md failed with 500"))
        : Promise.resolve(path === "b.md" ? "#flashcards/beta\n\nc::d\n" : "#flashcards/zeta\n"),
    );
    renderDecks();

    expect(await screen.findByRole("button", { name: /beta/ })).toHaveTextContent("1 new");
    expect(screen.queryByRole("button", { name: /alpha/ })).not.toBeInTheDocument();
    expect(screen.getByText(/to go/).textContent).toBe("1 to go");
  });

  it("asks the scan to skip the archive, or to walk it", async () => {
    const cards = vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);

    // The seeded scan is stale at once, so the mount still asks for it.
    renderDecks(HITS);
    screen.getByRole("button", { name: /alpha/ });
    expect(cards).toHaveBeenLastCalledWith(false);

    cleanup();
    renderDecks(HITS, true);
    screen.getByRole("button", { name: /alpha/ });
    expect(cards).toHaveBeenLastCalledWith(true);
  });

  it("imports without Anki's schedule unless asked, and counts what the merge did", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    const imported = vi.spyOn(api, "importAnki").mockResolvedValue({
      notes: ["Anki/AWS.md"],
      cards: 120,
      media: 2,
      added: 5,
      updated: 3,
      kept: 110,
      removed: 2,
    });
    renderDecks(HITS);
    screen.getByRole("button", { name: /alpha/ });
    const deck = new File(["apkg"], "aws.apkg");
    const carry = screen.getByRole("checkbox", { name: "Carry Anki's schedule" });

    expect(carry).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Import an Anki deck"), { target: { files: [deck] } });
    expect(imported).toHaveBeenLastCalledWith(deck, false);
    expect(
      await screen.findByText(
        "1 deck, 120 cards: 5 added, 3 updated, 110 kept, 2 removed in Anki, 2 media files",
      ),
    ).toBeInTheDocument();

    fireEvent.click(carry);
    fireEvent.change(screen.getByLabelText("Import an Anki deck"), { target: { files: [deck] } });
    expect(imported).toHaveBeenLastCalledWith(deck, true);
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
    screen.getByRole("button", { name: /alpha/ });

    expect(screen.getByLabelText("a link to an Anki deck")).not.toBeVisible();
    fireEvent.click(screen.getByText("Import"));
    expect(screen.getByLabelText("a link to an Anki deck")).toBeVisible();

    const button = screen.getByRole("button", { name: "Import an Anki deck" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveClass("border", "min-h-11");
    fireEvent.click(button);
    expect(opened).toEqual([screen.getByLabelText("Import an Anki deck")]);
  });

  it("#517 I8 closing and opening Import keeps the last import's line and the tick", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    vi.spyOn(api, "importAnki").mockResolvedValue({
      notes: ["Anki/AWS.md"],
      cards: 120,
      media: 0,
      added: 5,
      updated: 3,
      kept: 110,
      removed: 2,
    });
    renderDecks(HITS);
    screen.getByRole("button", { name: /alpha/ });
    const carry = screen.getByRole("checkbox", { name: "Carry Anki's schedule" });

    expect(carry).not.toBeVisible();
    const entry = screen.getByText("Import");
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

describe("ReviewDecks importing from a link", () => {
  const LINK = "https://ankiweb.net/shared/info/1104981491";
  const DONE = {
    notes: ["Anki/AWS.md"],
    cards: 120,
    media: 2,
    added: 5,
    updated: 3,
    kept: 110,
    removed: 2,
  };
  const SUMMARY =
    "1 deck, 120 cards: 5 added, 3 updated, 110 kept, 2 removed in Anki, 2 media files";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function renderDecks() {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    const client = seededClient(HITS);
    render(
      <QueryClientProvider client={client}>
        <ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /alpha/ });
    const field = screen.getByLabelText("a link to an Anki deck") as HTMLInputElement;
    return { field, button: screen.getByRole("button", { name: "Import link" }) };
  }

  it("A1 imports the pasted link and shows the line a file import shows", async () => {
    const imported = vi.spyOn(api, "importAnkiLink").mockResolvedValue(DONE);
    const { field, button } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);

    expect(imported).toHaveBeenLastCalledWith(LINK, false);
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
  });

  it("A2 carries Anki's schedule on a link import when ticked", async () => {
    const imported = vi.spyOn(api, "importAnkiLink").mockResolvedValue(DONE);
    const { field, button } = await renderDecks();

    fireEvent.click(screen.getByRole("checkbox", { name: "Carry Anki's schedule" }));
    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);

    expect(imported).toHaveBeenLastCalledWith(LINK, true);
    await screen.findByText(SUMMARY);
  });

  it("A10 imports on Enter in the field, the way a desk would", async () => {
    const imported = vi.spyOn(api, "importAnkiLink").mockResolvedValue(DONE);
    const { field } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    // jsdom does not submit a form on an Enter keypress, which a browser does
    // for a form holding a submit button, so the submit is sent as it would be.
    fireEvent.submit(field.form as HTMLFormElement);

    expect(imported).toHaveBeenLastCalledWith(LINK, false);
    await screen.findByText(SUMMARY);
  });

  it("A10 draws the field and button touch-sized in a row that wraps", async () => {
    const { field, button } = await renderDecks();

    expect(field).toHaveClass("min-h-11", "min-w-0", "flex-1");
    expect(button).toHaveClass("min-h-11");
    expect(field.type).toBe("url");
    expect(field.form?.parentElement).toHaveClass("flex-wrap");
  });

  it("I2 sends nothing for an empty or blank field", async () => {
    const imported = vi.spyOn(api, "importAnkiLink").mockResolvedValue(DONE);
    const { field, button } = await renderDecks();

    fireEvent.click(button);
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(button);

    expect(imported).not.toHaveBeenCalled();
  });

  it("I2 sends a link that is not a URL to the backend and shows its message", async () => {
    const imported = vi
      .spyOn(api, "importAnkiLink")
      .mockRejectedValue(new Error("Only https links"));
    const { field } = await renderDecks();
    const form = field.form as HTMLFormElement;

    // A browser checks a url field before it submits, and its own bubble would
    // stand in for the backend's sentence. jsdom does not run that check, so
    // the attribute that turns it off is what the test can see.
    expect(form.noValidate).toBe(true);
    fireEvent.change(field, { target: { value: "ankiweb.net/shared/info/1" } });
    fireEvent.submit(form);

    expect(imported).toHaveBeenLastCalledWith("ankiweb.net/shared/info/1", false);
    expect(await screen.findByText("Only https links")).toBeInTheDocument();
  });

  it("I3 imports once on a double tap, saying it is importing", async () => {
    // Never settles, so the import is still running at every assertion.
    const imported = vi.spyOn(api, "importAnkiLink").mockReturnValue(new Promise(() => {}));
    const { field, button } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(field.form as HTMLFormElement);

    expect(imported).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.getByText("Importing…")).toBeInTheDocument();
  });

  it("I4 typing in the link field fires none of /review's keys", async () => {
    const pane = await renderPane();
    const field = screen.getByLabelText("a link to an Anki deck");
    field.focus();

    fireEvent.keyDown(field, { key: "j" });
    fireEvent.keyDown(field, { key: "p" });

    expect(document.activeElement).toBe(field);
    expect(pane.querySelector("button[data-deck]")).not.toBeNull();

    // The same `p` on the pane does open the parked list, so the deck rows
    // still standing above is the field holding the key and not a dead key.
    fireEvent.keyDown(pane, { key: "p" });
    expect(pane.querySelector("button[data-deck]")).toBeNull();
  });

  it("I5 keeps the link after a failure and clears it after a success", async () => {
    const imported = vi
      .spyOn(api, "importAnkiLink")
      .mockRejectedValueOnce(new Error("AnkiWeb did not answer"))
      .mockResolvedValueOnce(DONE);
    const { field, button } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);
    await screen.findByText("AnkiWeb did not answer");
    expect(field.value).toBe(LINK);

    fireEvent.click(button);
    await screen.findByText(SUMMARY);
    expect(field.value).toBe("");
    expect(imported).toHaveBeenCalledTimes(2);
  });

  it("A7 shows a refusal's detail word for word", async () => {
    const detail = "That page is not an AnkiWeb shared deck, and the link is not an .apkg";
    vi.spyOn(api, "importAnkiLink").mockRejectedValue(new Error(detail));
    const { field, button } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);

    expect((await screen.findByText(detail)).textContent).toBe(detail);
  });
});

describe("ReviewPane on a nested cloze", () => {
  const NESTED = "#flashcards/capitals\n\n{{c1::Canberra was {{c2::founded}} in 1913}}\n";
  const HITS = [
    { path: "c.md", line: 1, text: "#flashcards/capitals" },
    { path: "c.md", line: 3, text: "{{c1::Canberra was {{c2::founded}} in 1913}}" },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("A8 a nested cloze is asked as c1 then c2 and rated by key", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    vi.spyOn(api, "fetchNote").mockResolvedValue(NESTED);
    // The vault answers with what was sent: the next rating starts from it.
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => ({ path, content }));
    const client = seededClient(HITS);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /capitals/ });
    const pane = screen.getByLabelText("review");

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });

    // c1 hides the whole span, the inner mark with it.
    expect(await shownCard()).toHaveTextContent(/^\[\.\.\.\]$/);
    fireEvent.keyDown(pane, { key: " " });
    expect(screen.getByTestId("review-back")).toHaveTextContent("Canberra was founded in 1913");
    fireEvent.keyDown(pane, { key: "3" });

    expect(saved.mock.calls[0]?.[1]).toMatch(
      /^#flashcards\/capitals\n\n\{\{c1::Canberra was \{\{c2::founded\}\} in 1913\}\} <!--SR:c1![\d-]+,1,250-->\n$/,
    );

    // c2 hides the inner word alone.
    await waitFor(() =>
      expect(screen.getByTestId("review-card")).toHaveTextContent(
        /^Canberra was \[\.\.\.\] in 1913$/,
      ),
    );
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "3" });

    expect(saved.mock.calls[1]?.[1]).toMatch(
      /^#flashcards\/capitals\n\n\{\{c1::Canberra was \{\{c2::founded\}\} in 1913\}\} <!--SR:c1![\d-]+,1,250--> <!--SR:c2![\d-]+,1,250-->\n$/,
    );
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
  });
});

describe("ReviewPane under a daily limit", () => {
  const DUE = "<!--SR:!2000-01-01,4,250-->";

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  /** The pane over `hits`, with `limits` as the vault's `decks.md`. */
  function renderLimited(hits: api.SearchHit[], limits: string) {
    vi.spyOn(api, "fetchCards").mockResolvedValue(hits);
    vi.spyOn(api, "fetchNote").mockImplementation((path) =>
      Promise.resolve(path === "99 Misc/01 Config/decks.md" ? limits : noteOf(hits, path)),
    );
    render(
      <QueryClientProvider client={seededClient(hits)}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  const row = (name: string) => document.querySelector(`button[data-deck="${name}"]`);

  it("A11 draws a deck's row with the due and new counts its decks.md line allows", async () => {
    renderLimited(
      [
        { path: "a.md", line: 1, text: "#flashcards/alpha" },
        { path: "a.md", line: 2, text: `a::b ${DUE}` },
        { path: "a.md", line: 3, text: `c::d ${DUE}` },
        { path: "a.md", line: 4, text: `e::f ${DUE}` },
        { path: "a.md", line: 5, text: "g::h" },
        { path: "a.md", line: 6, text: "i::j" },
        { path: "a.md", line: 7, text: "k::l" },
      ],
      "alpha: 1 new, 2 reviews\n",
    );

    await waitFor(() => expect(row("alpha")).toHaveTextContent("2 due"));
    expect(row("alpha")).toHaveTextContent("1 new");
  });

  it("A11 draws a folded parent with the counts its own limit allows", async () => {
    renderLimited(
      [
        { path: "g.md", line: 1, text: "#flashcards/trivia/geography" },
        { path: "g.md", line: 2, text: "a::b" },
        { path: "g.md", line: 3, text: "c::d" },
        { path: "h.md", line: 1, text: "#flashcards/trivia/history" },
        { path: "h.md", line: 2, text: "e::f" },
        { path: "h.md", line: 3, text: "g::h" },
      ],
      "trivia: 3 new\ntrivia/geography: 1 new\n",
    );

    await waitFor(() => expect(row("trivia")).toHaveTextContent("3 new"));
    expect(row("trivia/geography")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "unfold trivia" }));
    expect(row("trivia/geography")).toHaveTextContent("1 new");
    expect(row("trivia/history")).toHaveTextContent("2 new");
  });
});
