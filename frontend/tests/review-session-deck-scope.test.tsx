import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { type Deck, decksFrom } from "@/lib/review/review";
import { cardsOf } from "@/lib/review/review-queue";
import { shownCard } from "./review-card";
import { DECK } from "./review-session-fixture";

/**
 * How often a sitting parses its deck note (#1354). A count and not a time: a
 * 1 MB deck took one long task to open because the note was parsed three times,
 * and a loaded box moves a time but never a count.
 */
const parses = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/review/srs", async (original) => {
  const srs = await original<typeof import("@/lib/review/srs")>();
  return {
    ...srs,
    parseCards: (...args: Parameters<typeof srs.parseCards>) => {
      parses.count += 1;
      return srs.parseCards(...args);
    },
  };
});

describe("ReviewSession on a whole note", () => {
  const NOTE_DECK: Deck = {
    name: "tls",
    notes: ["notes/tls.md"],
    due: 1,
    fresh: 0,
    parked: 0,
    whole: true,
    next: null,
  };
  const MARKED =
    "---\nsr-due: 2026-01-01\nsr-interval: 4\nsr-ease: 250\n---\n# TLS\n\nthe handshake\n";

  function renderNote() {
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
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
    expect(screen.queryByRole("button", { name: "Show the answer" })).not.toBeInTheDocument();
  });

  it("does not ask a note its frontmatter parks", async () => {
    const parked = MARKED.replace("---\nsr-due:", "---\nsr-suspended: true\nsr-due:");
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
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

    fireEvent.click(screen.getByRole("button", { name: "Park this card" }));

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
    next: null,
  };
  const PROCS =
    "#flashcards/db\n\nWhat is a proc?::a block\n\n#flashcards/dbt What is a macro?::jinja\n";
  const DBT = "#flashcards/dbt\n\nWhat does dbt render?::sql\n";

  function renderSpread() {
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
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

    // Path order asks db/dbt.md first, then db/procs.md. The untagged card of
    // the procs note never comes up, so after the two tagged cards the sitting
    // is done.
    expect(await shownCard()).toHaveTextContent("What does dbt render?");
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(await shownCard()).toHaveTextContent("What is a macro?");
    expect(screen.getByTestId("review-card")).not.toHaveTextContent("What is a proc?");
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
  });

  it("writes each rating back into the note that card is in", async () => {
    const saved = renderSpread();
    await shownCard();

    // The dbt card comes first, so its rating is written into db/dbt.md.
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[0]?.[0]).toBe("db/dbt.md");
    expect(saved.mock.calls[0]?.[1]).toContain("What does dbt render?::sql <!--SR:!");
    expect(saved.mock.calls[0]?.[1]).toContain("#flashcards/dbt\n");

    expect(await shownCard()).toHaveTextContent("What is a macro?");

    // The tag stays on the line: a rating writes the comment and nothing else.
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[1]?.[0]).toBe("db/procs.md");
    expect(saved.mock.calls[1]?.[1]).toContain("#flashcards/dbt What is a macro?::jinja <!--SR:!");
    expect(saved.mock.calls[1]?.[1]).toContain("What is a proc?::a block\n");
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
    next: null,
  };
  const NESTED = "#flashcards/databases/postgres\n\nWhat is MVCC?::a row per version\n";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks the cards of the decks under it", async () => {
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
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

const TWO_NEW = "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";

function renderSitting() {
  vi.spyOn(api, "fetchNote").mockResolvedValue(TWO_NEW);
  vi.spyOn(api, "saveNote").mockImplementation(async (path, content) => ({ path, content }));
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("ReviewSession parsing its deck (#1354)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    parses.count = 0;
  });

  it("#1354 opening a deck parses its note once", async () => {
    renderSitting();
    expect(await shownCard()).toHaveTextContent("What is a VPC?");
    expect(parses.count).toBe(1);
  });

  it("#1379 a rating shifts the cards it holds rather than parse the note, and the next card is read off them", async () => {
    renderSitting();
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?"));
    // The open only. Main parsed the rating's text and the write's answer too, so three.
    await waitFor(() => expect(api.saveNote).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(parses.count).toBe(1);
  });

  it("#1354 the deck's row off its own cards is the row off the note's text", () => {
    // Two decks, a nested one, a parked card and a schedule due: every count a row has.
    const text = [
      "#flashcards/aws",
      "",
      "What is a VPC?::A private cloud <!--SR:!2026-01-01,4,250-->",
      "",
      "What is S3?::Storage",
      "",
      "What is IAM?::Identity #flashcards/aws/iam",
      "",
      "What is a join?::Rows together #flashcards/sql",
      "",
      "What is a view?:: #flashcards/sql",
      "",
    ].join("\n");
    const texts = new Map([["decks/aws.md", text]]);
    const limits = { note: "aws: 1 new\n", defaults: { new_per_day: null, reviews_per_day: null } };
    for (const name of ["aws", "aws/iam", "sql"]) {
      const deck = { ...DECK, name };
      const own = cardsOf(deck, texts).get("decks/aws.md");
      const row = (cards?: typeof own) =>
        decksFrom([{ path: "decks/aws.md", text, cards }], "2026-08-10", limits).find(
          (each) => !each.whole && each.name === name,
        );
      expect(row(own)).toEqual(row());
    }
  });
});
