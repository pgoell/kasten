import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review/review-session";
import * as api from "@/lib/core/api";
import { readClock, shiftDay } from "@/lib/core/clock";
import { noteBase } from "@/lib/notes/note-base";
import { type Deck, decksFrom, type Limits } from "@/lib/review/review";
import { parseCards } from "@/lib/review/srs";
import { answeredToday, readNoteSchedule } from "@/lib/review/srs-schedule";
import { shownCard } from "./review-card";
import { DECK } from "./review-session-fixture";

describe("ReviewSession rating a new card again (#816)", () => {
  // The rating stamps the day it reads at the press, so the clock is pinned (#1315).
  const NOW = new Date(2026, 7, 10, 12);
  const TODAY = readClock(NOW).date;
  const TOMORROW = shiftDay(TODAY, 1);
  const ONE_NEW = "aws: 1 new\n";
  /** The FSRS comment a rating today writes, `fields` being interval to learning step (#1926). */
  const fsrs = (due: string, fields: string) =>
    `<!--SR:!fsrs,${due}T00:00:00.000Z,${fields},${TODAY}T00:00:00.000Z-->`;
  const TWO_NEW = "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";

  /**
   * The sitting over a vault holding one note, and `decks.md`.
   *
   * The vault refuses a write whose base is not the hash of the text it holds,
   * the way the backend's conditional `PUT` does, so the text the sitting wrote
   * is what `vault.disk` ends up holding and nothing here is set up by hand.
   */
  function renderVault(start: string, deck: Deck, decksNote: string) {
    const vault = { disk: start };
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
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

  /** The aws row the overview draws off the note as the vault holds it now. */
  function awsRow(text: string, decksNote: string) {
    const limits: Limits = {
      note: decksNote,
      defaults: { new_per_day: null, reviews_per_day: null },
    };
    return decksFrom([{ path: "decks/aws.md", text }], TODAY, limits).find(
      (deck) => deck.name === "aws",
    );
  }

  /** Turn the card and rate it, then let the rating's write land. */
  async function rate(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    fireEvent.click(screen.getByRole("button", { name }));
    await act(async () => {});
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.setSystemTime(NOW);
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("#816 a new card rated again then good counts as one new card and the overview offers the limit less one", async () => {
    const { vault } = renderVault(TWO_NEW, { ...DECK, fresh: 1 }, ONE_NEW);
    await shownCard();
    await rate("Again");
    expect(screen.getByTestId("review-card")).toHaveTextContent("What is a VPC?");
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();

    // FSRS keeps the card in learning, due today, which still counts as new.
    expect(vault.disk).toContain(
      `What is a VPC?::A private cloud ${fsrs(TODAY, "0,0.24,6.40,1,2,0,1")}`,
    );
    expect(awsRow(vault.disk, ONE_NEW)?.fresh).toBe(0);
  });

  it("#816 a new card rated again then easy leaves learning the same day and reads as a review", async () => {
    const { vault } = renderVault(TWO_NEW, { ...DECK, fresh: 1 }, ONE_NEW);
    await shownCard();
    await rate("Again");
    await rate("Easy");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();

    expect(vault.disk).toContain(
      `What is a VPC?::A private cloud ${fsrs(TOMORROW, "1,0.42,5.20,2,2,0,0")}`,
    );
    // The comment cannot tell a card that left learning on its first day from a review,
    // so the new slot comes back: one new card more that day (#1926, YOURS TO OVERRULE).
    expect(awsRow(vault.disk, ONE_NEW)?.fresh).toBe(1);
  });

  it("#816 the mark written after again then good reads new off the vault in the form obsidian-spaced-repetition reads", async () => {
    const { vault } = renderVault(TWO_NEW, { ...DECK, fresh: 1 }, ONE_NEW);
    await shownCard();
    await rate("Again");
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();

    expect(vault.disk).toContain(fsrs(TODAY, "0,0.24,6.40,1,2,0,1"));
    const held = parseCards(vault.disk, "aws")[0]?.held ?? null;
    expect(answeredToday(held, TODAY)).toBe("new");
  });

  it("#816 a new card rated again twice then good still counts one new card", async () => {
    const { vault } = renderVault(TWO_NEW, { ...DECK, fresh: 1 }, ONE_NEW);
    await shownCard();
    await rate("Again");
    await rate("Again");
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();

    expect(vault.disk).toContain(
      `What is a VPC?::A private cloud ${fsrs(TODAY, "0,0.10,8.80,1,3,0,1")}`,
    );
    expect(awsRow(vault.disk, ONE_NEW)?.fresh).toBe(0);
  });

  it("#816 a card that was a review at sitting start, rated again then good, turns into FSRS from its SM-2 schedule", async () => {
    // Guard: green on main too, since only a card new at the start is changed.
    const DUE = "#flashcards/aws\n\nWhat is a VPC?::A private cloud <!--SR:!2020-01-01,3,250-->\n";
    const { vault } = renderVault(DUE, { ...DECK, fresh: 0, due: 1 }, "");
    await shownCard();
    await rate("Again");
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();

    // Again converts it and lapses it into relearning; Good passes it, two days out.
    expect(vault.disk).toContain(fsrs(shiftDay(TODAY, 2), "2,1.72,8.50,2,4,1,0"));
  });

  it("#1926 I8 undo of the rating that turned an SM-2 card into FSRS puts the SM-2 comment back byte for byte", async () => {
    const DUE = "#flashcards/aws\n\nWhat is a VPC?::A private cloud <!--SR:!2020-01-01,3,250-->\n";
    const { vault } = renderVault(DUE, { ...DECK, fresh: 0, due: 1 }, "");
    await shownCard();
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
    expect(vault.disk).toContain("<!--SR:!fsrs,");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(vault.disk).toBe(DUE));
  });

  it("#816 undo of the second rating then rating again rates the card the undo put back", async () => {
    const ONE = "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n";
    const { vault } = renderVault(ONE, { ...DECK, fresh: 1 }, ONE_NEW);
    await shownCard();
    await rate("Again");
    await rate("Good");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(screen.getByTestId("review-card")).toHaveTextContent("What is a VPC?"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    await act(async () => {});

    expect(vault.disk).toContain(
      // The undo put back the first again's comment, so this is a second again in learning.
      `What is a VPC?::A private cloud ${fsrs(TODAY, "0,0.08,8.81,1,2,0,0")}`,
    );
  });

  it("#816 a whole note marked #review, new at start, rated again then good reads new from its frontmatter", async () => {
    const NOTE = "# TLS #review\n\nthe handshake\n";
    const whole: Deck = {
      name: "tls",
      notes: ["notes/tls.md"],
      due: 0,
      fresh: 1,
      parked: 0,
      whole: true,
      next: null,
    };
    const { vault } = renderVault(NOTE, whole, "");
    await shownCard();
    // A whole note is shown from the start, so the ratings are the only buttons.
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await act(async () => {});
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();

    expect(vault.disk).toContain(`sr-due: ${TOMORROW}`);
    expect(vault.disk).toContain("sr-interval: 1");
    expect(vault.disk).toContain("sr-ease: 250");
    expect(answeredToday(readNoteSchedule(vault.disk), TODAY)).toBe("new");
  });
});
