import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { noteOf, renderPane, seededClient, serveNotes } from "./review-pane-fixture";
import { stubCommands } from "./stub-commands";

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
    const client = seededClient(hits);
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    return client;
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

  it("#517 j and k stop on the toggle of a parent its limit empties, and za and j reach the subdeck", async () => {
    const hits = [
      { path: "a.md", line: 1, text: "#flashcards/alpha" },
      { path: "a.md", line: 2, text: "a::b" },
      { path: "g.md", line: 1, text: "#flashcards/trivia/geography" },
      { path: "g.md", line: 2, text: "c::d" },
      { path: "g.md", line: 3, text: "e::f" },
    ];
    const client = renderLimited(hits, "trivia: 0 new, 0 reviews\ntrivia/geography: 5 new\n");
    // Every read in, the limits among them, so the rows count what they allow.
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const pane = screen.getByLabelText("review");
    const press = (key: string) => fireEvent.keyDown(pane, { key });

    press("j");
    press("j");
    expect(document.activeElement, "j stops on the trivia toggle").toHaveAttribute(
      "data-fold",
      "trivia",
    );
    press("k");
    expect(document.activeElement).toBe(row("alpha"));
    press("j");
    press("z");
    press("a");
    expect(row("trivia/geography")).not.toBeNull();
    expect(row("trivia")).toBeDisabled();

    press("j");
    expect(document.activeElement).toBe(row("trivia/geography"));
    press("l");
    expect(await shownCard()).toHaveTextContent(/^(c|e)$/);
  });
});
