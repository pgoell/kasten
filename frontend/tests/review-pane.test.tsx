import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewPane } from "@/components/review-pane";
import * as api from "@/lib/api";
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

async function renderPane() {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: /alpha/ });
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

    expect(await screen.findByTestId("review-card")).toHaveTextContent("c");
  });
});

describe("ReviewPane on a nested deck", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("draws the deck under its parent, called by its last part", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue([
      { path: "d.md", line: 1, text: "#flashcards/databases/postgres" },
      { path: "d.md", line: 2, text: "a::b" },
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );

    const parent = await screen.findByRole("button", { name: /databases/ });
    const child = screen.getByRole("button", { name: /postgres/ });
    expect(parent).toHaveAttribute("data-deck", "databases");
    expect(child).toHaveAttribute("data-deck", "databases/postgres");
    expect(child.style.paddingLeft).toBe("1.5rem");
  });

  it("counts the card once in the header, not once per row above it", async () => {
    vi.spyOn(api, "fetchCards").mockResolvedValue([
      { path: "d.md", line: 1, text: "#flashcards/databases/postgres" },
      { path: "d.md", line: 2, text: "a::b" },
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );

    await screen.findByRole("button", { name: /postgres/ });

    expect(screen.getByText(/to go/).textContent).toBe("1 to go");
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
    await screen.findByTestId("review-card");

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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: /alpha/ });
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
    expect(await screen.findByTestId("review-card")).toHaveTextContent("c");

    fireEvent.keyDown(pane, { key: "s" });

    expect(screen.getByTestId("review-card")).toHaveTextContent("e");
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <ReviewPane commands={stubCommands()} onClose={vi.fn()} onOpen={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: /alpha/ });
    const pane = screen.getByLabelText("review");
    fireEvent.keyDown(pane, { key: "p" });
    return { pane, container };
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
});
