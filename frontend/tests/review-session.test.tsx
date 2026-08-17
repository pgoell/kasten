import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review";

const DECK: Deck = {
  name: "aws",
  notes: ["decks/aws.md"],
  due: 0,
  fresh: 1,
  parked: 0,
  whole: false,
};

const NOTE = "#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service\n";

function renderSession() {
  vi.spyOn(api, "fetchNote").mockResolvedValue(NOTE);
  vi.spyOn(api, "saveNote").mockResolvedValue({ path: "decks/aws.md", content: NOTE });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={DECK} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );

  return screen.findByTestId("review-card");
}

describe("ReviewSession typing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks for a button press when typing is off", async () => {
    await renderSession();

    expect(screen.getByRole("button", { name: "Show answer" })).toBeInTheDocument();
    expect(screen.queryByLabelText("your answer")).not.toBeInTheDocument();
  });

  it("asks for the answer in writing once typing is on", async () => {
    await renderSession();

    fireEvent.click(screen.getByRole("button", { name: "Type" }));

    expect(screen.getByLabelText("your answer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show answer" })).not.toBeInTheDocument();
  });

  it("keeps the ratings back until the answer is in", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));

    expect(screen.queryByRole("button", { name: "Good" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "Simple Storage Service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-back")).toHaveTextContent("Simple Storage Service");
    expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument();
  });

  it("says the answer matched", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "simple storage service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-verdict")).toHaveTextContent("Matched");
  });

  it("shows what was typed beside the answer when it did not match", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "Simple Store Service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    const verdict = screen.getByTestId("review-verdict");
    expect(verdict).toHaveTextContent("Simple Store Service");
    // The rating is still yours to give: a mismatch never refuses one.
    expect(screen.getByRole("button", { name: "Easy" })).toBeInTheDocument();
  });

  it("remembers the toggle across a remount", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    expect(localStorage.getItem("kasten.review.typing")).toBe("on");

    cleanup();
    await renderSession();

    expect(screen.getByLabelText("your answer")).toBeInTheDocument();
  });
});

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

    const card = await screen.findByTestId("review-card");
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
    await screen.findByTestId("review-card");

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    const written = saved.mock.calls[0]?.[1] ?? "";
    expect(written).toContain("sr-suspended: true");
    expect(written).toContain("sr-due: 2026-01-01");
    expect(written.split("\n")[0]).toBe("---");
    expect(written).not.toContain("!suspended");
  });

  it("writes the schedule into the note's frontmatter", async () => {
    const saved = renderNote();
    await screen.findByTestId("review-card");

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
    expect(await screen.findByTestId("review-card")).toHaveTextContent("What is a macro?");
    expect(screen.getByTestId("review-card")).not.toHaveTextContent("What is a proc?");
  });

  it("writes each rating back into the note that card is in", async () => {
    const saved = renderSpread();
    await screen.findByTestId("review-card");

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[0]?.[0]).toBe("db/procs.md");
    // The tag stays on the line: a rating writes the comment and nothing else.
    expect(saved.mock.calls[0]?.[1]).toContain("#flashcards/dbt What is a macro?::jinja <!--SR:!");
    expect(saved.mock.calls[0]?.[1]).toContain("What is a proc?::a block\n");

    expect(await screen.findByTestId("review-card")).toHaveTextContent("What does dbt render?");

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

    expect(await screen.findByTestId("review-card")).toHaveTextContent("What is MVCC?");
  });
});

describe("ReviewSession on a parked card", () => {
  const PARKED =
    "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\n" +
    "What is Direct Connect?::A private link !suspended\n";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const TWO =
    "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\n" +
    "What is Direct Connect?::A private link\n";

  function renderTwo() {
    vi.spyOn(api, "fetchNote").mockResolvedValue(TWO);
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({
      path: "decks/aws.md",
      content: TWO,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  it("writes the token onto the card on screen", async () => {
    const saved = renderTwo();
    await screen.findByTestId("review-card");

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(saved.mock.calls[0]?.[0]).toBe("decks/aws.md");
    expect(saved.mock.calls[0]?.[1]).toContain("What is a VPC?::A private cloud !suspended");
    expect(saved.mock.calls[0]?.[1]).toContain("What is Direct Connect?::A private link\n");
  });

  it("drops it from the queue and moves to the next card", async () => {
    renderTwo();
    await screen.findByTestId("review-card");
    expect(screen.getByText(/left/).textContent).toBe("2 left");

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(screen.getByText(/left/).textContent).toBe("1 left");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is Direct Connect?");
  });

  it("leaves the parked card out of the queue", async () => {
    vi.spyOn(api, "fetchNote").mockResolvedValue(PARKED);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, parked: 1 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );

    const card = await screen.findByTestId("review-card");
    expect(card).toHaveTextContent("What is a VPC?");
    expect(card).not.toHaveTextContent("What is Direct Connect?");
    expect(screen.getByText(/left/).textContent).toBe("1 left");
  });
});
