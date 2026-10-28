import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { readClock } from "@/lib/clock";
import type { Deck } from "@/lib/review/review";
import { shownCard } from "./review-card";

// The sitting reads the day when it runs, so a run crossing midnight would see
// the next day while a read taken at the top of the file saw this one (#1315).
const NOW = new Date(2026, 7, 10, 12);
// The day the sitting reads as today, so the due dates below fall on it.
const TODAY = readClock(NOW).date;

const DECK: Deck = {
  name: "aws",
  notes: ["decks/aws.md"],
  due: 0,
  fresh: 1,
  parked: 0,
  whole: false,
  next: null,
};

const WHOLE: Deck = { ...DECK, whole: true };

/** One card nobody has answered, which the sitting asks as a first answer. */
const FRESH = "#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service\n";

/** The same card, held: due today, and `interval` days since the answer before it. */
function held(interval: number, due = TODAY) {
  return `#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service <!--SR:!${due},${interval},250-->\n`;
}

/** The sitting over `text`, with the writes it makes and the callback it opens sources with. */
function renderSitting(text: string, deck: Deck = DECK) {
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  vi.spyOn(api, "fetchNote").mockImplementation((path) =>
    Promise.resolve(path === "decks/aws.md" ? text : ""),
  );
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));
  const onOpen = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={deck} onLeave={vi.fn()} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return { saved, onOpen };
}

/** Turn the card over, under either label, so the answer side is reached on main too. */
function reveal() {
  fireEvent.click(screen.getByRole("button", { name: /^Show (the )?answer$/ }));
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

it("#790 A2 the question names the deck and the count, and Show the answer carries a Space hint", async () => {
  renderSitting(FRESH);
  await shownCard();

  expect(screen.getByRole("button", { name: "Show the answer" })).toHaveTextContent("Space");
  expect(screen.getByText("aws")).toHaveClass("font-mono", "text-k-13", "text-k-muted");
  expect(screen.getByText("1 left")).toBeInTheDocument();
});

it("#790 A2 Park this card parks the card, the note holding the suspend token", async () => {
  const { saved } = renderSitting(FRESH);
  await shownCard();

  fireEvent.click(screen.getByRole("button", { name: "Park this card" }));

  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(saved.mock.calls[0]?.[1]).toContain("!suspended");
});

it("#790 A2 Write a new question opens the capture line", async () => {
  renderSitting(FRESH);
  await shownCard();

  const link = screen.getByRole("button", { name: "Write a new question" });
  fireEvent.click(link);

  expect(link).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("textbox", { name: "a new question" })).toBeInTheDocument();
});

it("#790 A2 a cloze question draws its gap as a pill with the brackets in it", async () => {
  renderSitting("#flashcards/aws\n\nS3 stands for {{c1::Simple Storage Service}}\n");
  await shownCard();

  await waitFor(() => {
    const gap = document.querySelector("[data-gap]");
    expect(gap).not.toBeNull();
    expect(gap).toHaveTextContent("[...]");
  });
});

it("#790 A3 the answer sits under a rule, with the note, the line and when it was last seen in its words", async () => {
  renderSitting(held(4));
  await shownCard();
  reveal();

  expect(screen.getByText(/^From /)).toHaveTextContent("From aws, line 3, last seen 4 days ago");
  expect(screen.getByTestId("review-back")).toHaveClass("border-t", "border-k-rule");
});

it("#790 A6 the source link opens the card's line", async () => {
  const { onOpen } = renderSitting(held(4));
  await shownCard();
  reveal();

  fireEvent.click(screen.getByRole("button", { name: "aws, line 3" }));

  expect(onOpen).toHaveBeenCalledWith("decks/aws.md", 3);
});

it("#790 A6 a whole note's source link opens the note with no line", async () => {
  const note = `---\nsr-due: ${TODAY}\nsr-interval: 4\nsr-ease: 250\n---\n# TLS\n\nthe handshake\n`;
  const { onOpen } = renderSitting(note, WHOLE);
  await shownCard();

  expect(screen.getByText(/^From /)).toHaveTextContent(/^From aws, last seen 4 days ago$/);
  fireEvent.click(screen.getByRole("button", { name: "aws" }));

  expect(onOpen).toHaveBeenCalledWith("decks/aws.md");
});

it("#790 I6 a card new at the start shows first-answer intervals on its buttons", async () => {
  renderSitting(FRESH);
  await shownCard();
  reveal();

  expect(screen.getByRole("button", { name: "Again" })).toHaveAccessibleDescription("today");
  expect(screen.getByRole("button", { name: "Hard" })).toHaveAccessibleDescription("1d");
  expect(screen.getByRole("button", { name: "Good" })).toHaveAccessibleDescription("1d");
  expect(screen.getByRole("button", { name: "Easy" })).toHaveAccessibleDescription("4d");
});

it("#790 A3 a card with a schedule shows the interval each rating writes", async () => {
  renderSitting(held(10));
  await shownCard();
  reveal();

  // Ten days at the starting ease: again halves it, hard grows it by 1.2, good by
  // 2.5, easy by 2.65 and its 1.3 bonus on top. The strings are the ones the
  // overview draws for those counts: days under a fortnight, weeks after.
  expect(screen.getByRole("button", { name: "Again" })).toHaveAccessibleDescription("5d");
  expect(screen.getByRole("button", { name: "Hard" })).toHaveAccessibleDescription("12d");
  expect(screen.getByRole("button", { name: "Good" })).toHaveAccessibleDescription("4w");
  expect(screen.getByRole("button", { name: "Easy" })).toHaveAccessibleDescription("5w");
});

it("#790 A3 Again is in the danger colour and Good is the outlined default", async () => {
  renderSitting(FRESH);
  await shownCard();
  reveal();

  expect(screen.getByRole("button", { name: "Good" })).toHaveAttribute("data-default");
  expect(screen.getByRole("button", { name: "Good" })).toHaveClass("border-k-accent");
  expect(screen.getByRole("button", { name: "Again" })).toHaveClass("text-k-danger");
});

it("#790 A4 the done screen says what was done and when the next cards are due", async () => {
  renderSitting(FRESH);
  await shownCard();
  reveal();

  fireEvent.click(screen.getByRole("button", { name: "Good" }));

  expect(await screen.findByRole("heading", { name: "Done for today" })).toBeInTheDocument();
  expect(screen.getByTestId("review-done")).toHaveTextContent("1 answered today in aws.");
  expect(screen.getByTestId("review-done")).toHaveTextContent("The next cards are due tomorrow.");
});

it("#790 A4 the done screen says when nothing in the deck is scheduled", async () => {
  renderSitting("#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service !suspended\n");

  expect(await screen.findByText("Nothing in aws is scheduled yet.")).toBeInTheDocument();
});

it("#790 I8 Undo on the done screen brings the last card back", async () => {
  renderSitting(FRESH);
  await shownCard();
  reveal();
  fireEvent.click(screen.getByRole("button", { name: "Good" }));

  expect(await screen.findByRole("heading", { name: "Done for today" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));

  await waitFor(() =>
    expect(screen.getByTestId("review-card")).toHaveTextContent("What does S3 stand for?"),
  );
});
