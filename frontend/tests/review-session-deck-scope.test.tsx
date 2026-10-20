import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review";
import { shownCard } from "./review-card";

describe("ReviewSession on a whole note", () => {
  const NOTE_DECK: Deck = {
    name: "tls",
    notes: ["notes/tls.md"],
    due: 1,
    fresh: 0,
    parked: 0,
    whole: true,
  };
  const MARKED =
    "---\nsr-due: 2026-01-01\nsr-interval: 4\nsr-ease: 250\n---\n# TLS\n\nthe handshake\n";

  function renderNote() {
    vi.spyOn(api, "fetchNote").mockResolvedValue(MARKED);
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({
      path: "notes/tls.md",
      content: MARKED,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={NOTE_DECK} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the note without its frontmatter and rates it straight away", async () => {
    renderNote();

    const card = await shownCard();
    expect(card).toHaveTextContent("the handshake");
    expect(card).not.toHaveTextContent("sr-ease");
    expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show answer" })).not.toBeInTheDocument();
  });

  it("does not ask a note its frontmatter parks", async () => {
    const parked = MARKED.replace("---\nsr-due:", "---\nsr-suspended: true\nsr-due:");
    vi.spyOn(api, "fetchNote").mockResolvedValue(parked);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...NOTE_DECK, due: 0, parked: 1 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
    expect(screen.queryByTestId("review-card")).not.toBeInTheDocument();
  });

  it("parks a whole note through its frontmatter, not through a line", async () => {
    const saved = renderNote();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    const written = saved.mock.calls[0]?.[1] ?? "";
    expect(written).toContain("sr-suspended: true");
    expect(written).toContain("sr-due: 2026-01-01");
    expect(written.split("\n")[0]).toBe("---");
    expect(written).not.toContain("!suspended");
  });

  it("writes the schedule into the note's frontmatter", async () => {
    const saved = renderNote();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved).toHaveBeenCalledOnce();
    const written = saved.mock.calls[0]?.[1] ?? "";
    expect(written).toContain("sr-interval: 10");
    expect(written).toContain("the handshake");
  });
});

describe("ReviewSession on a deck spanning two notes", () => {
  const SPREAD: Deck = {
    name: "dbt",
    notes: ["db/procs.md", "db/dbt.md"],
    due: 0,
    fresh: 2,
    parked: 0,
    whole: false,
  };
  const PROCS =
    "#flashcards/db\n\nWhat is a proc?::a block\n\n#flashcards/dbt What is a macro?::jinja\n";
  const DBT = "#flashcards/dbt\n\nWhat does dbt render?::sql\n";

  function renderSpread() {
    vi.spyOn(api, "fetchNote").mockImplementation((path: string) =>
      Promise.resolve(path === "db/procs.md" ? PROCS : DBT),
    );
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({ path: "db/procs.md", content: "" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={SPREAD} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks only the cards of this deck, out of every note holding one", async () => {
    renderSpread();

    // The tagged card of the procs note, and not the untagged one beside it.
    expect(await shownCard()).toHaveTextContent("What is a macro?");
    expect(screen.getByTestId("review-card")).not.toHaveTextContent("What is a proc?");
  });

  it("writes each rating back into the note that card is in", async () => {
    const saved = renderSpread();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[0]?.[0]).toBe("db/procs.md");
    // The tag stays on the line: a rating writes the comment and nothing else.
    expect(saved.mock.calls[0]?.[1]).toContain("#flashcards/dbt What is a macro?::jinja <!--SR:!");
    expect(saved.mock.calls[0]?.[1]).toContain("What is a proc?::a block\n");

    expect(await shownCard()).toHaveTextContent("What does dbt render?");

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[1]?.[0]).toBe("db/dbt.md");
  });
});

describe("ReviewSession on a parent deck", () => {
  const PARENT: Deck = {
    name: "databases",
    notes: ["db/postgres.md"],
    due: 0,
    fresh: 1,
    parked: 0,
    whole: false,
  };
  const NESTED = "#flashcards/databases/postgres\n\nWhat is MVCC?::a row per version\n";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks the cards of the decks under it", async () => {
    vi.spyOn(api, "fetchNote").mockResolvedValue(NESTED);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={PARENT} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(await shownCard()).toHaveTextContent("What is MVCC?");
  });
});
