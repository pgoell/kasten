import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review";
import { shownCard } from "./review-card";

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
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({
      path: "decks/aws.md",
      content: text,
    });
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
