/**
 * The flashcard a finger grades (#790), at a phone's width with touch emulated:
 * a tap shows the answer, a swipe past 38 % of the card grades it, a short slow
 * swipe springs back, and the screen never moves sideways.
 *
 * Pointers are real `PointerEvent`s dispatched on the card, a frame apart, so
 * the gesture and the spring run as they do under a thumb. The card's own
 * numbers (its tilt, its stamp, its touch-action) are read off the browser.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { ReviewSession } from "@/components/review-session";
import { readClock } from "@/lib/clock";
import type { Deck } from "@/lib/review/review";
import { nextSchedule } from "@/lib/review/srs-schedule";
import "@/styles/app.css";

// The writes the sitting makes, counted here; the note is answered, not stored.
const { writes } = vi.hoisted(() => ({ writes: vi.fn<(path: string, content: string) => void>() }));

const NOTE =
  "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\nWhat does S3 stand for?::Simple Storage Service\n";
const VPC = "What is a VPC?";
const S3 = "What does S3 stand for?";
const DECK: Deck = {
  name: "aws",
  notes: ["decks/aws.md"],
  due: 0,
  fresh: 2,
  parked: 0,
  whole: false,
  next: null,
};

// The sitting's reads and writes, answered here and not by a server. The rest
// kept, as the browser checks every named import the graph holds.
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchNote: (path: string) =>
    path === "decks/aws.md"
      ? Promise.resolve(NOTE)
      : Promise.reject(new Error(`GET /api/files/${path} failed with 404`)),
  saveNote: (path: string, content: string) => {
    writes(path, content);
    return Promise.resolve({ path, content });
  },
  fetchReviewLimits: () => Promise.reject(new Error("GET /api/review/limits failed with 404")),
}));

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(async () => {
  localStorage.clear();
  writes.mockClear();
  // A synthetic pointer is no active pointer, so the browser refuses the capture
  // a real finger would hold. The capture is not under test, so it is a no-op here.
  vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
  await page.viewport(390, 844);
  await commands.emulateMedia({ touch: true });
});

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  vi.restoreAllMocks();
  await commands.emulateMedia({});
  await page.viewport(414, 896);
});

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Frames until `ms` has passed, so a finger can hold still for real time. */
async function framesFor(ms: number): Promise<void> {
  const end = performance.now() + ms;
  do {
    await nextFrame();
  } while (performance.now() < end);
}

/** Mounts the sitting on the deck, and waits for the first question to draw. */
async function mount(): Promise<HTMLElement> {
  const div = document.body.appendChild(document.createElement("div"));
  div.className = "h-dvh w-full";
  host = div;
  root = createRoot(div);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSession deck={DECK} onLeave={() => {}} />
    </QueryClientProvider>,
  );
  await expect.poll(() => div.querySelector('[data-testid="review-card"] .cm-line')).not.toBeNull();
  return div;
}

const cardOf = (screen: HTMLElement) =>
  screen.querySelector<HTMLElement>('[data-testid="review-card"]') as HTMLElement;
const swipeOf = (screen: HTMLElement) =>
  screen.querySelector<HTMLElement>('[data-testid="review-swipe"]');

/** Shows the answer the way a click on the footer does, so a swipe is the only thing under test. */
async function reveal(screen: HTMLElement): Promise<void> {
  (screen.querySelector("footer button") as HTMLButtonElement).click();
  await expect.poll(() => screen.querySelector('button[data-rating="good"]')).not.toBeNull();
}

/** One pointer event of a touch, as the browser sends it for a finger. */
function finger(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * A finger drawn sideways across the middle of `target` by `dx` px, in `moves`
 * steps a frame apart. It is lifted after `hold` ms of stillness, unless `lift`
 * is false, which leaves it down for the test to read the card mid-swipe.
 */
async function slide(
  target: Element,
  dx: number,
  moves: number,
  { hold = 0, lift = true } = {},
): Promise<void> {
  const box = target.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  finger(target, "pointerdown", x, y);
  for (let step = 1; step <= moves; step++) {
    await nextFrame();
    finger(target, "pointermove", x + (dx * step) / moves, y);
  }
  if (!lift) return;
  await framesFor(hold);
  finger(target, "pointerup", x + dx, y);
}

/** The identity transform, however the browser spells it. */
const AT_REST = /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/;

it("a tap on the question shows the answer", async () => {
  const screen = await mount();
  const line = screen.querySelector('[data-testid="review-question"] .cm-line') as HTMLElement;
  const box = line.getBoundingClientRect();
  finger(line, "pointerdown", box.left + 4, box.top + 4);
  finger(line, "pointerup", box.left + 4, box.top + 4);
  await expect.poll(() => screen.querySelector('[data-testid="review-back"]')).not.toBeNull();
});

it("a swipe right past 38 % grades the card Good and shows the next", async () => {
  const screen = await mount();
  await reveal(screen);
  await slide(cardOf(screen), 260, 6);

  const good = nextSchedule(null, "good", readClock(new Date()).date);
  await expect.poll(() => writes.mock.calls.length).toBe(1);
  expect(writes.mock.calls[0]?.[1]).toContain(
    `<!--SR:!${good.due},${good.interval},${good.ease}-->`,
  );
  await expect.poll(() => cardOf(screen).textContent).toContain(S3);
});

it("a swipe left past 38 % grades the card Again", async () => {
  const screen = await mount();
  await reveal(screen);
  await slide(cardOf(screen), -260, 6);

  const again = nextSchedule(null, "again", readClock(new Date()).date);
  await expect.poll(() => writes.mock.calls.length).toBe(1);
  expect(writes.mock.calls[0]?.[1]).toContain(
    `<!--SR:!${again.due},${again.interval},${again.ease}-->`,
  );
  // Again sends the card to the back of the queue, so the second card comes up.
  await expect.poll(() => cardOf(screen).textContent).toContain(S3);
});

it("a short slow swipe springs back and grades nothing", async () => {
  const screen = await mount();
  await reveal(screen);
  await slide(cardOf(screen), 60, 6, { hold: 120 });

  const swipe = swipeOf(screen);
  expect(swipe, "the swipe card").not.toBeNull();
  // Settled back at rest, which is the spring's end and not the release.
  await expect.poll(() => getComputedStyle(swipe as HTMLElement).transform).toMatch(AT_REST);
  expect(writes).not.toHaveBeenCalled();
  expect(cardOf(screen).textContent).toContain(VPC);
});

it("mid-swipe at 100 px the card tilts 2.5 degrees and the Good stamp shows", async () => {
  const screen = await mount();
  await reveal(screen);
  await slide(cardOf(screen), 100, 6, { lift: false });

  const swipe = swipeOf(screen);
  expect(swipe, "the swipe card").not.toBeNull();
  // matrix(cos, sin, -sin, cos, x, 0) for a rotation: the angle is atan2 of the sine and cosine.
  const [a, b, , , x] = getComputedStyle(swipe as HTMLElement)
    .transform.slice("matrix(".length, -1)
    .split(", ")
    .map(Number);
  expect((Math.atan2(b ?? 0, a ?? 1) * 180) / Math.PI).toBeCloseTo(2.5, 1);
  expect(x).toBeCloseTo(100, 0);

  const good = screen.querySelector<HTMLElement>('[data-stamp="good"]') as HTMLElement;
  expect(Number(getComputedStyle(good).opacity)).toBeGreaterThan(0);
  expect(
    Number(getComputedStyle(screen.querySelector('[data-stamp="again"]') as Element).opacity),
  ).toBe(0);
});

it("after a swipe the screen does not move sideways", async () => {
  const screen = await mount();
  await reveal(screen);
  await slide(cardOf(screen), 260, 6);
  // Long enough for the fly-off and the spring to end, so a sideways move from either would show.
  await framesFor(600);

  expect(document.documentElement.scrollLeft).toBe(0);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    document.documentElement.clientWidth,
  );
});

it("the card claims the vertical pan and keeps sideways overscroll in", async () => {
  const screen = await mount();
  const swipe = swipeOf(screen);
  expect(swipe, "the swipe card").not.toBeNull();
  const style = getComputedStyle(swipe as HTMLElement);
  expect(style.touchAction).toBe("pan-y");
  expect(style.overscrollBehaviorX).toBe("contain");
});

it("with reduced motion a swipe past 38 % grades at once", async () => {
  await commands.emulateMedia({ touch: true, reducedMotion: "reduce" });
  const screen = await mount();
  await reveal(screen);
  await slide(cardOf(screen), 260, 6);
  // Two frames: the spring's fly-off would take a good deal longer than this.
  await nextFrame();
  await nextFrame();

  expect(writes).toHaveBeenCalledTimes(1);
  await expect.poll(() => cardOf(screen).textContent).toContain(S3);
});

it("A8 the grade buttons are 64 px high on touch, a thumb's 44 at least", async () => {
  const screen = await mount();
  await reveal(screen);
  // The phone's answer is a finger's: the coarse query must match, or the taller rule is not in play.
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);

  const buttons = [...screen.querySelectorAll<HTMLButtonElement>("button[data-rating]")];
  expect(buttons.map((button) => button.dataset.rating)).toEqual(["again", "hard", "good", "easy"]);
  for (const button of buttons) {
    // 64 is `pointer-coarse:min-h-16`, which a finger's answer draws (#793 A11).
    expect(button.getBoundingClientRect().height, button.dataset.rating).toBe(64);
  }
});
