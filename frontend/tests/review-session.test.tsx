import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { readClock } from "@/lib/clock";
import { noteBase } from "@/lib/note-base";
import { type Deck, decksFrom } from "@/lib/review";
import { shownCard } from "./review-card";

/** What the session hands a shell to put its keys over. */
type ReviewControls = Parameters<NonNullable<Parameters<typeof ReviewSession>[0]["onControls"]>>[0];

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

  return shownCard();
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

  it("A3 counts a typed a\\-b right against an imported back a\\\\-b", async () => {
    const note = "#flashcards/aws\n\nWhat is it?::a\\\\-b \\*c\\* <!--anki:1:0:abcdef12-->\n";
    vi.spyOn(api, "fetchNote").mockResolvedValue(note);
    vi.spyOn(api, "saveNote").mockResolvedValue({ path: "decks/aws.md", content: note });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={DECK} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), { target: { value: "a\\-b *c*" } });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-verdict")).toHaveTextContent("Matched");
  });

  it("A3 counts a typed &#58; right against an imported back \\&#58;", async () => {
    const note = "#flashcards/aws\n\nWhat is it?::a\\\\\\&#58; \\&#58; <!--anki:1:0:abcdef12-->\n";
    vi.spyOn(api, "fetchNote").mockResolvedValue(note);
    vi.spyOn(api, "saveNote").mockResolvedValue({ path: "decks/aws.md", content: note });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={DECK} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "a\\&#58; &#58;" },
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
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(saved.mock.calls[0]?.[0]).toBe("decks/aws.md");
    expect(saved.mock.calls[0]?.[1]).toContain("What is a VPC?::A private cloud !suspended");
    expect(saved.mock.calls[0]?.[1]).toContain("What is Direct Connect?::A private link\n");
  });

  it("names the text it read as the first save's base, and that save's answer as the next", async () => {
    const saved = renderTwo();
    // The vault's answer differs from what was sent, the way a stamp makes it.
    saved.mockImplementation(async (path: string, content: string) => ({
      path,
      content: `${content}\nlanded\n`,
    }));
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[0]?.slice(2)).toEqual([false, noteBase(TWO)]);
    expect(saved.mock.calls[1]?.[1]).toContain("landed");
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(`${saved.mock.calls[0]?.[1]}\nlanded\n`));
  });

  it("holds a second rating's write until the first answers, and names that answer", async () => {
    const saved = renderTwo();
    let answer: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          // The stamped block a note without one comes back with.
          answer = () => resolve({ path, content: `---\nid: x\n---\n${content}` });
        }),
    );
    saved.mockImplementation(async (path: string, content: string) => ({ path, content }));
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    expect(saved).toHaveBeenCalledTimes(1);

    await act(async () => answer?.());

    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(`---\nid: x\n---\n${saved.mock.calls[0]?.[1]}`));
  });

  it("reads the note again after a refused rating, and names that text next", async () => {
    const saved = renderTwo();
    saved.mockRejectedValueOnce(new api.ChangedOnDisk());
    const reread = `${TWO}\nsomebody else's line\n`;
    await shownCard();
    vi.mocked(api.fetchNote).mockResolvedValue(reread);

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(reread));
    expect(screen.getByText(/could not be written: Changed on disk/)).toBeInTheDocument();
  });

  it("sends a rating queued behind a refused one, naming the unlanded text, and says it failed", async () => {
    const saved = renderTwo();
    let refuse: (() => void) | undefined;
    saved.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          refuse = () => reject(new api.ChangedOnDisk());
        }),
    );
    saved.mockRejectedValueOnce(new Error("the second was refused"));
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => refuse?.());
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(saved.mock.calls[0]?.[1] ?? ""));
    expect(screen.getByText(/could not be written: the second was refused/)).toBeInTheDocument();
  });

  it("names the old screen text for a rating made while the re-read is out", async () => {
    const saved = renderTwo();
    saved.mockRejectedValueOnce(new api.ChangedOnDisk());
    await shownCard();
    let reread: (() => void) | undefined;
    vi.mocked(api.fetchNote).mockImplementation(
      () =>
        new Promise((resolve) => {
          reread = () => resolve(`${TWO}\nsomebody else's line\n`);
        }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    expect(reread).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => reread?.());
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(saved.mock.calls[0]?.[1] ?? ""));
  });

  it("drops it from the queue and moves to the next card", async () => {
    renderTwo();
    await shownCard();
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

    const card = await shownCard();
    expect(card).toHaveTextContent("What is a VPC?");
    expect(card).not.toHaveTextContent("What is Direct Connect?");
    expect(screen.getByText(/left/).textContent).toBe("1 left");
  });
});

describe("ReviewSession on a cloze", () => {
  const CLOZE = "#flashcards/aws\n\nThe capital of {{c1::France}} is {{c2::Paris::a city}}.\n";

  function renderCloze(text = CLOZE) {
    vi.spyOn(api, "fetchNote").mockResolvedValue(text);
    // The vault answers with what was sent: the next rating starts from it.
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => ({ path, content }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks each number in turn, writing each one's own comment on the line", async () => {
    const saved = renderCloze();

    expect(await shownCard()).toHaveTextContent("The capital of [...] is Paris.");
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByTestId("review-back")).toHaveTextContent("France");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[0]?.[1]).toMatch(
      /^#flashcards\/aws\n\nThe capital of \{\{c1::France\}\} is \{\{c2::Paris::a city\}\}\. <!--SR:c1![\d-]+,1,250-->\n$/,
    );

    await waitFor(() =>
      expect(screen.getByTestId("review-card")).toHaveTextContent(
        "The capital of France is [a city].",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Easy" }));

    expect(saved.mock.calls[1]?.[1]).toMatch(
      /^#flashcards\/aws\n\nThe capital of \{\{c1::France\}\} is \{\{c2::Paris::a city\}\}\. <!--SR:c1![\d-]+,1,250--> <!--SR:c2![\d-]+,4,250-->\n$/,
    );
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
  });

  it("rewrites one number's comment in place when it is asked again", async () => {
    const saved = renderCloze();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    // c2, then c1 once more at the back of the queue.
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("[a city]"));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("[...]"));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Again" }));

    const last = saved.mock.calls.at(-1)?.[1] ?? "";
    expect(last.match(/<!--SR:c1!/g)).toHaveLength(1);
    expect(last.match(/<!--SR:c2!/g)).toHaveLength(1);
  });

  it("matches what was typed against the hidden text, not the sentence", async () => {
    renderCloze();
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), { target: { value: "france" } });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-verdict")).toHaveTextContent("Matched");
  });

  it("drops every number from the queue when one is parked", async () => {
    const saved = renderCloze();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(saved.mock.calls[0]?.[1]).toContain("{{c2::Paris::a city}}. !suspended\n");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
  });
});

describe("ReviewSession jotting a new question", () => {
  const DECK_NOTE = "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderJot() {
    vi.spyOn(api, "fetchNote").mockResolvedValue(DECK_NOTE);
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({
      path: "decks/aws.md",
      content: DECK_NOTE,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  it("appends it to the note the card on screen came from", async () => {
    const saved = renderJot();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), {
      target: { value: "What is a moved block?" },
    });
    fireEvent.submit(screen.getByTestId("review-capture"));

    expect(saved.mock.calls[0]?.[0]).toBe("decks/aws.md");
    expect(saved.mock.calls[0]?.[1]).toContain("What is a moved block?::");
  });

  it("leaves the card on screen and the queue behind it alone", async () => {
    renderJot();
    await shownCard();
    expect(screen.getByText(/left/).textContent).toBe("2 left");

    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), {
      target: { value: "What is a moved block?" },
    });
    fireEvent.submit(screen.getByTestId("review-capture"));

    expect(screen.getByTestId("review-card")).toHaveTextContent("What is a VPC?");
    expect(screen.getByText(/left/).textContent).toBe("2 left");
  });

  it("closes the field once the question is written", async () => {
    renderJot();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), { target: { value: "Q" } });
    fireEvent.submit(screen.getByTestId("review-capture"));

    expect(screen.queryByLabelText("a new question")).not.toBeInTheDocument();
  });

  it("shuts the field on a second tap, writing nothing", async () => {
    const saved = renderJot();
    await shownCard();

    const button = screen.getByRole("button", { name: "Jot" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(screen.getByLabelText("a new question"), { target: { value: "Q" } });
    fireEvent.click(button);

    expect(screen.queryByLabelText("a new question")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(saved).not.toHaveBeenCalled();
  });

  // jsdom lays nothing out, so the class is the nearest thing to a width there
  // is to assert. "Jot" and "Type" are the two labels narrower than 44px.
  it("gives its narrow header buttons a thumb's width on a touch screen", async () => {
    renderJot();
    await shownCard();

    for (const name of ["Jot", "Type"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("min-h-11", "pointer-coarse:min-w-11");
    }
  });
});

/** Where an Anki import files a deck's media, percent-encoded as the note holds it. */
const MEDIA = "Flashcards/Japanese%20media";

function renderDeck(note: string) {
  vi.spyOn(api, "fetchNote").mockResolvedValue(note);
  vi.spyOn(api, "saveNote").mockResolvedValue({ path: "decks/aws.md", content: note });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("ReviewSession on a card with pictures", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("draws a picture on both sides of the card", async () => {
    renderDeck(`#flashcards/aws\n\nLook ![](${MEDIA}/front.png)::Back ![](${MEDIA}/back.png)\n`);

    const card = await shownCard();
    await waitFor(() =>
      expect(card.querySelector("img.cm-image")?.getAttribute("src")).toBe(
        `/api/assets/${MEDIA}/front.png`,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

    await waitFor(() =>
      expect(
        screen.getByTestId("review-back").querySelector("img.cm-image")?.getAttribute("src"),
      ).toBe(`/api/assets/${MEDIA}/back.png`),
    );
  });
});

describe("ReviewSession playing a card's sounds", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** jsdom builds a media element and plays nothing, so the player is stubbed. */
  function stubPlayer() {
    // The source read when `play` is called: the session reuses one element,
    // so reading it off the calls afterwards would answer the last one each time.
    const sources: string[] = [];
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      sources.push(this.src);
      return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    const played = () => [...sources];
    return { play, pause, played };
  }

  it("plays an audio-only front when the card shows", async () => {
    const { played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か\n`);

    await waitFor(() => expect(played()).toHaveLength(1));
    expect(played()[0]).toMatch(/\/api\/assets\/Flashcards\/Japanese%20media\/kana\.mp3$/);
  });

  it("plays the back's sound on reveal", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か ![](${MEDIA}/ka.mp3)\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

    expect(played()).toHaveLength(2);
    expect(played()[1]).toMatch(/\/ka\.mp3$/);
  });

  it("stops the front's sound on reveal when the back has none", async () => {
    const { play, pause } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    pause.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
  });

  // Asserted straight after the tap and never waited for: a phone lets a sound
  // start only inside the tap that asked for it, so a play from an effect after
  // the render would be refused there.
  it("plays the next card's front from inside the rating", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/a.mp3)::あ\n\n![](${MEDIA}/i.mp3)::い\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(played().at(-1)).toMatch(/\/i\.mp3$/);
  });

  it("plays the next card's front from inside a suspend", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/a.mp3)::あ\n\n![](${MEDIA}/i.mp3)::い\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(played().at(-1)).toMatch(/\/i\.mp3$/);
  });

  it("plays the sounds of one side one after the other", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/one.mp3) ![](${MEDIA}/two.mp3)::x\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(played()[0]).toMatch(/\/one\.mp3$/);

    const player = play.mock.contexts[0] as HTMLMediaElement;
    fireEvent(player, new Event("ended"));

    expect(played()).toHaveLength(2);
    expect(played()[1]).toMatch(/\/two\.mp3$/);

    // The last one ending is the end of the side, not a reason to start over.
    fireEvent(player, new Event("ended"));
    expect(played()).toHaveLength(2);
  });

  it("moves on to the next sound when one cannot play", async () => {
    const { play, played } = stubPlayer();
    // A file deleted from the vault: the play is refused as unsupported.
    play.mockRejectedValueOnce(new DOMException("gone", "NotSupportedError"));
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/missing.mp3) ![](${MEDIA}/two.mp3)::x\n`);

    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(played()).toHaveLength(1);
    expect(played()[0]).toMatch(/\/two\.mp3$/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("moves on to the next sound when the player reports an error", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/missing.mp3) ![](${MEDIA}/two.mp3)::x\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    fireEvent(play.mock.contexts[0] as HTMLMediaElement, new Event("error"));

    expect(played()).toHaveLength(2);
    expect(played()[1]).toMatch(/\/two\.mp3$/);
  });

  it("stops the sound when the card is rated and the next has none", async () => {
    const { play, pause } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/a.mp3)::あ\n\nquiet::silent\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    pause.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
  });

  it("stops the sound when the sitting is left", async () => {
    const { play, pause } = stubPlayer();
    const { unmount } = renderDeck(`#flashcards/aws\n\n![](${MEDIA}/a.mp3)::あ\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    pause.mockClear();

    unmount();

    expect(pause).toHaveBeenCalled();
  });

  it("replays the side showing on a tap", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か ![](${MEDIA}/ka.mp3)\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    const replay = screen.getByRole("button", { name: "Replay" });
    expect(replay).toHaveClass("min-h-11", "pointer-coarse:min-w-11");
    fireEvent.click(replay);
    expect(played()).toHaveLength(2);
    expect(played()[1]).toMatch(/\/kana\.mp3$/);

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(played().at(-1)).toMatch(/\/ka\.mp3$/);
    expect(played().filter((src) => src.endsWith("/ka.mp3"))).toHaveLength(2);
  });

  it("draws Replay only on a side that has a sound", async () => {
    stubPlayer();
    renderDeck(`#flashcards/aws\n\nquiet::loud ![](${MEDIA}/ka.mp3)\n`);
    await shownCard();

    expect(screen.queryByRole("button", { name: "Replay" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));

    expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
  });

  it("says nothing when the browser refuses to start a sound, and plays on the tap", async () => {
    const { play, played } = stubPlayer();
    play.mockRejectedValueOnce(new DOMException("no gesture", "NotAllowedError"));
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));

    // The refused call went past the recording stub, so the tap is the one held.
    expect(play).toHaveBeenCalledTimes(2);
    expect(played().at(-1)).toMatch(/\/kana\.mp3$/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ReviewSession under a daily limit", () => {
  const TRIVIA: Deck = {
    name: "trivia",
    notes: ["decks/trivia.md"],
    due: 2,
    fresh: 1,
    parked: 0,
    whole: false,
  };
  const DUE = "<!--SR:!2020-01-01,3,250-->";
  const CARDS =
    "#flashcards/trivia\n\n" +
    `Due one?::a ${DUE}\n\nDue two?::a ${DUE}\n\nDue three?::a ${DUE}\n\n` +
    "New one?::a\n\nNew two?::a\n\nNew three?::a\n";

  function renderLimited() {
    vi.spyOn(api, "fetchNote").mockImplementation((path: string) =>
      Promise.resolve(path === "99 Misc/01 Config/decks.md" ? "trivia: 1 new, 2 reviews\n" : CARDS),
    );
    vi.spyOn(api, "saveNote").mockImplementation((path: string, content: string) =>
      Promise.resolve({ path, content }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={TRIVIA} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("A12 asks no more cards than the deck's limits in decks.md allow", async () => {
    renderLimited();
    await shownCard();

    expect(screen.getByText("3 left")).toBeInTheDocument();
  });

  it("I2 asks exactly the due and new cards the overview row promised, then stops", async () => {
    renderLimited();

    const asked: string[] = [];
    for (let turn = 0; turn < 3; turn += 1) {
      asked.push((await shownCard()).textContent ?? "");
      fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
      fireEvent.click(screen.getByRole("button", { name: "Good" }));
    }

    expect(asked).toEqual(["Due one?", "Due two?", "New one?"]);
    expect(await screen.findByTestId("review-done")).toHaveTextContent("3 answered");
  });
});

describe("ReviewSession centring the card (#600)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // jsdom lays nothing out, so the classes are what is asserted here and the
  // frame test `review-center` measures where the text lands.
  it("#600 A3 Center centres the card across and down, and off keeps today's layout", async () => {
    const card = await renderSession();
    const toggle = screen.queryByRole("button", { name: "Center" });
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(card).not.toHaveClass("text-center");
    expect(card.parentElement).not.toHaveClass("flex");

    fireEvent.click(toggle as HTMLElement);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveClass("my-auto", "w-full", "text-center");
    expect(card.parentElement).toHaveClass("flex", "flex-col", "overflow-auto");
    // A card taller than the pane would lose its top to `justify-center`.
    expect(card.parentElement).not.toHaveClass("justify-center");

    fireEvent.click(toggle as HTMLElement);

    expect(card).not.toHaveClass("text-center");
    expect(card.parentElement).not.toHaveClass("flex");
  });

  it("#600 A4 remembers Center across a remount", async () => {
    await renderSession();
    const toggle = screen.queryByRole("button", { name: "Center" });
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLElement);
    expect(localStorage.getItem("kasten.review.center")).toBe("on");

    cleanup();
    const card = await renderSession();

    expect(screen.getByRole("button", { name: "Center" })).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveClass("text-center");
  });
});

describe("ReviewSession undoing the last step (#600)", () => {
  const TWO = "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";
  const MOVED_ON = "The note changed since that step, so it was not undone.";

  /**
   * The sitting over a vault holding one note, and `decks.md`.
   *
   * The vault refuses a write whose base is not the hash of the text it holds,
   * the way the backend's conditional `PUT` does, so a refusal here comes of the
   * base the sitting named and never of a rejection set up for the test.
   */
  function renderVault(start = TWO, deck: Deck = { ...DECK, fresh: 2 }, decksNote = "") {
    const vault = { disk: start };
    vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) =>
      path === "99 Misc/01 Config/decks.md" ? decksNote : vault.disk,
    );
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string, _keep?: boolean, base?: string) => {
        if (base !== noteBase(vault.disk)) throw new api.ChangedOnDisk();
        vault.disk = content;
        return { path, content };
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={deck} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return { vault, saved };
  }

  const undoButton = () => screen.queryByRole("button", { name: "Undo" });

  /** Turn the card and rate it, then let the rating's write land. */
  async function rate(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name }));
    await act(async () => {});
  }

  /** The card on screen, once the undo has put `question` back on it. */
  function backOn(question: string) {
    return waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent(question));
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("#600 A5 Undo takes back a rating: the old text goes back and the card comes back revealed, first", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is a VPC?");
    expect(screen.getByTestId("review-back")).toHaveTextContent("A private cloud");
    expect(screen.getByText(/left/).textContent).toBe("2 left");
    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[1]).toBe(TWO);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(saved.mock.calls[0]?.[1] ?? ""));
    expect(vault.disk).toBe(TWO);
  });

  it("#600 A6 Undo takes back a suspend, putting the cloze's other number back in the queue too", async () => {
    const cloze = "#flashcards/aws\n\nThe capital of {{c1::France}} is {{c2::Paris::a city}}.\n";
    const { vault } = renderVault(cloze);
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    await act(async () => {});
    expect(screen.getByTestId("review-done")).toBeInTheDocument();
    expect(vault.disk).toContain("!suspended");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("The capital of [...] is Paris.");
    expect(screen.getByTestId("review-back")).toHaveTextContent("France");
    expect(screen.getByText(/left/).textContent).toBe("2 left");
    expect(vault.disk).toBe(cloze);
  });

  it("#600 A7 holds one step: after an undo there is nothing more to take back", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    await rate("Good");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is S3?");
    expect(undoButton()).toBeNull();
    expect(saved).toHaveBeenCalledTimes(3);
    // The rating before the one taken back stands.
    expect(vault.disk).toContain("What is a VPC?::A private cloud <!--SR:");
    expect(vault.disk).toContain("What is S3?::Storage\n");
  });

  it("#600 A8 an undone rating gives the card back its place under the daily limit", async () => {
    const limits = { note: "aws: 1 new\n", defaults: { new_per_day: null, reviews_per_day: null } };
    const today = readClock(new Date()).date;
    const row = (text: string) =>
      decksFrom([{ path: "decks/aws.md", text }], today, limits).find(
        (deck) => deck.name === "aws",
      );
    const { vault } = renderVault(TWO, { ...DECK, fresh: 1 }, limits.note);
    await shownCard();
    expect(screen.getByText(/left/).textContent).toBe("1 left");
    await rate("Good");
    expect(screen.getByTestId("review-done")).toBeInTheDocument();
    expect(row(vault.disk)?.fresh).toBe(0);

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is a VPC?");
    expect(row(vault.disk)?.fresh).toBe(1);
  });

  it("#600 A9 an undo over a note changed since the step writes nothing and says so", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    // Another pane, or the disk, writes over the rated note.
    const other = `${vault.disk}\nwritten elsewhere\n`;
    vault.disk = other;

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(MOVED_ON));
    expect(screen.getByRole("alert")).not.toHaveTextContent("could not be written");
    expect(saved).toHaveBeenCalledTimes(2);
    expect(vault.disk).toBe(other);
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
    expect(screen.queryByTestId("review-back")).toBeNull();
    expect(screen.getByText(/left/).textContent).toBe("1 left");
  });

  it("#600 I1 rating the last card leaves Undo on the done screen, and it brings the card back", async () => {
    renderVault();
    await shownCard();
    await rate("Good");
    await rate("Good");
    expect(screen.getByTestId("review-done")).toHaveTextContent("2 answered");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is S3?");
    expect(screen.getByTestId("review-back")).toHaveTextContent("Storage");
    expect(screen.getByText(/left/).textContent).toBe("1 left");
  });

  it("#600 I2 undoing Again leaves no second seat of the card and takes the answer off the count", async () => {
    renderVault();
    await shownCard();
    await rate("Again");
    expect(screen.getByText(/left/).textContent).toBe("2 left");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await backOn("What is a VPC?");
    expect(screen.getByText(/left/).textContent).toBe("2 left");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toHaveTextContent("2 answered");
  });

  it("#600 I3 an undo pressed while the rating's write is out waits behind it and names its answer", async () => {
    const { vault, saved } = renderVault();
    let answer: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          answer = () => {
            // The stamped block a note without one comes back with.
            vault.disk = `---\nid: x\n---\n${content}`;
            resolve({ path, content: vault.disk });
          };
        }),
    );
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await act(async () => {});
    expect(saved).toHaveBeenCalledTimes(1);
    expect(undoButton()).toHaveAttribute("aria-disabled", "true");

    await act(async () => answer?.());

    await backOn("What is a VPC?");
    expect(saved).toHaveBeenCalledTimes(2);
    expect(saved.mock.calls[1]?.[1]).toBe(TWO);
    expect(saved.mock.calls[1]?.[3]).toBe(noteBase(`---\nid: x\n---\n${saved.mock.calls[0]?.[1]}`));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(vault.disk).toBe(TWO);
  });

  it("#600 I4 an undo after a jot into the same note is refused, keeping the question", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), {
      target: { value: "What is a moved block?" },
    });
    fireEvent.submit(screen.getByTestId("review-capture"));
    await act(async () => {});
    // The jot named the rating's answer as its base, and landed.
    expect(vault.disk).toContain("What is a moved block?::");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(MOVED_ON));
    expect(saved).toHaveBeenCalledTimes(3);
    expect(saved.mock.calls[2]?.[3]).toBe(noteBase(saved.mock.calls[0]?.[1] ?? ""));
    expect(vault.disk).toContain("What is a moved block?::");
    expect(vault.disk).toContain("What is a VPC?::A private cloud <!--SR:");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
  });

  it("#600 I5 an undo the network fails restores nothing and says why", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    const rated = vault.disk;
    saved.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "The note could not be written: Failed to fetch",
      ),
    );
    expect(vault.disk).toBe(rated);
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
    expect(undoButton()).toBeNull();
  });

  it("#600 I6 a whole note gets its frontmatter schedule back, and then its suspend", async () => {
    const marked =
      "---\nsr-due: 2026-01-01\nsr-interval: 4\nsr-ease: 250\n---\n# TLS\n\nthe handshake\n";
    const { vault } = renderVault(marked, {
      name: "tls",
      notes: ["notes/tls.md"],
      due: 1,
      fresh: 0,
      parked: 0,
      whole: true,
    });
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    expect(vault.disk).toContain("sr-interval: 10");

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await waitFor(() => expect(vault.disk).toBe(marked));
    await backOn("the handshake");

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    await act(async () => {});
    expect(vault.disk).toContain("sr-suspended: true");
    fireEvent.click(undoButton() as HTMLElement);

    await waitFor(() => expect(vault.disk).toBe(marked));
    await backOn("the handshake");
  });

  it("#600 an undo after the rating's write failed is refused, writing nothing", async () => {
    const { vault, saved } = renderVault();
    saved.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await shownCard();
    await rate("Good");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("could not be written: Failed to fetch"),
    );

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);

    // The rating never landed, so the base the undo names is one the vault
    // never held, and it refuses rather than guess.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(MOVED_ON));
    expect(saved).toHaveBeenCalledTimes(2);
    expect(vault.disk).toBe(TWO);
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is S3?");
  });

  it("#600 B1 nothing rates, parks, turns or jots the next card while an undo is out", async () => {
    // A in one note and B in another, so nothing done to B waits behind the
    // undo's write in the queue of A's note.
    const disk = new Map([
      ["x.md", "#flashcards/aws\n\nWhat is A?::a\n"],
      ["y.md", "#flashcards/aws\n\nWhat is B?::b\n"],
    ]);
    vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) => disk.get(path) ?? "");
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => {
        disk.set(path, content);
        return { path, content };
      });
    // What the pane's keys reach, kept as the session hands it over.
    const held: { controls: ReviewControls } = { controls: null };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession
          deck={{ ...DECK, notes: ["x.md", "y.md"], fresh: 2 }}
          onLeave={vi.fn()}
          onControls={(given) => {
            held.controls = given;
          }}
        />
      </QueryClientProvider>,
    );
    await shownCard();
    await rate("Good");
    let release: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          release = () => {
            disk.set(path, content);
            resolve({ path, content });
          };
        }),
    );

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await act(async () => {});

    expect(screen.getByTestId("review-card")).toHaveTextContent("What is B?");
    for (const name of ["Show answer", "Suspend", "Jot"]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-disabled", "true");
    }
    // Taps on the greyed buttons, and the pane's keys, which reach the same
    // callbacks.
    for (const name of ["Show answer", "Suspend", "Jot"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    act(() => {
      held.controls?.reveal();
      held.controls?.capture();
      held.controls?.rate("good");
      held.controls?.suspend();
    });
    expect(screen.queryByTestId("review-back")).toBeNull();
    expect(screen.queryByTestId("review-capture")).toBeNull();
    expect(saved).toHaveBeenCalledTimes(2);

    await act(async () => release?.());

    // A back revealed, then B asked once: nothing done while the undo was out
    // came back through its landing.
    await backOn("What is A?");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toHaveTextContent("2 answered");
    expect(saved).toHaveBeenCalledTimes(4);
  });

  it("#600 B2 a jot sent while an undo is out stays in its line and goes once the undo lands", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await rate("Good");
    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), {
      target: { value: "What is a moved block?" },
    });
    let release: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          release = () => {
            vault.disk = content;
            resolve({ path, content });
          };
        }),
    );

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await act(async () => {});
    fireEvent.submit(screen.getByTestId("review-capture"));
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("a new question")).toHaveValue("What is a moved block?");

    await act(async () => release?.());
    await backOn("What is a VPC?");
    fireEvent.submit(screen.getByTestId("review-capture"));
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(3);
    expect(vault.disk).toContain("What is a VPC?::A private cloud\n");
    expect(vault.disk).toContain("What is a moved block?::");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("#600 B4 a jot held through an undo lands in the note it was opened on", async () => {
    const disk = new Map([
      ["x.md", "#flashcards/aws\n\nWhat is A?::a\n"],
      ["y.md", "#flashcards/aws\n\nWhat is B?::b\n"],
    ]);
    vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) => disk.get(path) ?? "");
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => {
        disk.set(path, content);
        return { path, content };
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, notes: ["x.md", "y.md"], fresh: 2 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    await shownCard();
    await rate("Good");
    // Opened on B, which lives in y.md.
    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), { target: { value: "Q?" } });

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await backOn("What is A?");
    fireEvent.submit(screen.getByTestId("review-capture"));
    await act(async () => {});

    expect(saved).toHaveBeenCalledTimes(3);
    expect(saved.mock.calls[2]?.[0]).toBe("y.md");
    expect(disk.get("y.md")).toContain("Q?::");
    expect(disk.get("x.md")).not.toContain("Q?");
  });

  it("#600 B5 Jot it and Check are disabled while an undo is out, their text kept", async () => {
    localStorage.setItem("kasten.review.typing", "on");
    const { saved } = renderVault();
    await shownCard();
    fireEvent.submit(screen.getByTestId("review-typed"));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), { target: { value: "Q?" } });
    fireEvent.change(screen.getByLabelText("your answer"), { target: { value: "Storage" } });
    let release: (() => void) | undefined;
    saved.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          release = () => resolve({ path, content });
        }),
    );

    const undo = undoButton();
    expect(undo).not.toBeNull();
    fireEvent.click(undo as HTMLElement);
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Jot it" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Check" })).toBeDisabled();
    expect(screen.getByLabelText("a new question")).toHaveValue("Q?");
    expect(screen.getByLabelText("your answer")).toHaveValue("Storage");

    await act(async () => release?.());
    await backOn("What is a VPC?");
    expect(screen.getByRole("button", { name: "Jot it" })).not.toBeDisabled();
  });
});
