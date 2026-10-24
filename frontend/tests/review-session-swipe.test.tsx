import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import type { Deck } from "@/lib/review";
import { stubMatchMedia } from "./match-media";
import { shownCard } from "./review-card";

const REDUCED = "(prefers-reduced-motion: reduce)";
const WIDTH = 390;

const DECK: Deck = {
  name: "aws",
  notes: ["decks/aws.md"],
  due: 0,
  fresh: 1,
  parked: 0,
  whole: false,
  next: null,
};

const ONE = "#flashcards/aws\n\nWhat does S3 stand for?::Simple Storage Service\n";
const TWO = `${ONE}\nWhat is a VPC?::A private cloud\n`;

// The gesture reads `performance.now` for its speed, so the clock is the test's.
let clock = 0;
function at(ms: number) {
  clock = ms;
}

let vibrate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  // Reduced motion makes each spring jump to its end, so a release lands at once.
  stubMatchMedia({ [REDUCED]: true });
  vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  // jsdom has no pointer capture, and the card asks for it once a drag is decided.
  Element.prototype.setPointerCapture = () => {};
  // jsdom has no layout, so the card is the width of a phone.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: WIDTH,
  } as DOMRect);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "vibrate");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A touch pointer event on `target`, which bubbles to the card the gesture is read on. */
function pointer(target: Element, type: string, x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, pointerType: "touch" });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** The sitting over `text`, with the writes it makes. */
function renderSitting(text: string) {
  vi.spyOn(api, "fetchNote").mockImplementation((path) =>
    Promise.resolve(path === "decks/aws.md" ? text : ""),
  );
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path, content) => ({ path, content }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={DECK} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );
  return { saved };
}

/** The answer side, under either label, so the reveal is reached on main too. */
function reveal() {
  fireEvent.click(screen.getByRole("button", { name: /^Show (the )?answer$/ }));
}

/** A sideways drag from `from` to `to`, released past the card's grading distance. */
function drag(from: number, to: number) {
  const card = screen.getByTestId("review-card");
  pointer(card, "pointerdown", from, 300);
  at(16);
  pointer(card, "pointermove", to, 300);
  at(32);
  pointer(card, "pointerup", to, 300);
}

it("#790 A6 a swipe right past 38 percent writes exactly what a click on Good writes", async () => {
  const swiped = renderSitting(ONE);
  await shownCard();
  reveal();
  drag(100, 250);
  await waitFor(() => expect(swiped.saved).toHaveBeenCalledOnce());
  const bySwipe = swiped.saved.mock.calls[0]?.[1];
  cleanup();

  vi.restoreAllMocks();
  const clicked = renderSitting(ONE);
  await shownCard();
  reveal();
  fireEvent.click(screen.getByRole("button", { name: "Good" }));
  await waitFor(() => expect(clicked.saved).toHaveBeenCalledOnce());

  expect(bySwipe).toBe(clicked.saved.mock.calls[0]?.[1]);
});

it("#790 A6 a swipe left past 38 percent writes exactly what a click on Again writes", async () => {
  const swiped = renderSitting(ONE);
  await shownCard();
  reveal();
  drag(100, -150);
  await waitFor(() => expect(swiped.saved).toHaveBeenCalledOnce());
  const bySwipe = swiped.saved.mock.calls[0]?.[1];
  cleanup();

  vi.restoreAllMocks();
  const clicked = renderSitting(ONE);
  await shownCard();
  reveal();
  fireEvent.click(screen.getByRole("button", { name: "Again" }));
  await waitFor(() => expect(clicked.saved).toHaveBeenCalledOnce());

  expect(bySwipe).toBe(clicked.saved.mock.calls[0]?.[1]);
});

it("#790 A6 a touch tap on the question reveals the answer", async () => {
  const { saved } = renderSitting(ONE);
  await shownCard();

  const card = screen.getByTestId("review-card");
  pointer(card, "pointerdown", 100, 300);
  at(16);
  pointer(card, "pointerup", 100, 300);

  expect(await screen.findByTestId("review-back")).toBeInTheDocument();
  expect(saved).not.toHaveBeenCalled();
});

it("#790 A6 a swipe on the question side writes nothing", async () => {
  const { saved } = renderSitting(ONE);
  await shownCard();

  drag(100, 250);
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
  expect(screen.queryByTestId("review-back")).not.toBeInTheDocument();
});

it("#790 A6 a short swipe on the answer springs back and writes nothing", async () => {
  const { saved } = renderSitting(ONE);
  await shownCard();
  reveal();

  const card = screen.getByTestId("review-card");
  pointer(card, "pointerdown", 100, 300);
  at(16);
  pointer(card, "pointermove", 130, 300);
  // Held still a long while before the release, so the finger has no speed.
  at(300);
  pointer(card, "pointerup", 130, 300);
  await act(async () => {});

  expect(saved).not.toHaveBeenCalled();
  expect(vibrate).not.toHaveBeenCalled();
});

it("#790 A6 a button grade does not buzz, and a swipe grade buzzes once with 8", async () => {
  const { saved } = renderSitting(TWO);
  await shownCard();
  reveal();
  fireEvent.click(screen.getByRole("button", { name: "Good" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(vibrate).not.toHaveBeenCalled();

  await shownCard();
  reveal();
  drag(100, 250);

  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(vibrate).toHaveBeenCalledOnce();
  expect(vibrate).toHaveBeenCalledWith(8);
});

it("#790 A6 a swipe while an undo is out writes nothing more", async () => {
  // The first write lands, and the undo that follows is held, so it stays out.
  let writes = 0;
  const { saved } = renderSitting(TWO);
  saved.mockImplementation((path, content) => {
    writes += 1;
    return writes === 1 ? Promise.resolve({ path, content }) : new Promise(() => {});
  });
  await shownCard();
  reveal();
  fireEvent.click(screen.getByRole("button", { name: "Good" }));
  await act(async () => {});
  await shownCard();
  reveal();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await act(async () => {});

  drag(100, 250);
  await act(async () => {});

  expect(saved).toHaveBeenCalledTimes(2);
});
