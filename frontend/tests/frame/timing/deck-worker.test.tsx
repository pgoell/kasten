/**
 * A deck's open parses in a worker (#1359): it reads the cards the main thread
 * reads, a grade writes the same line, and a worker that fails leaves the parse
 * to the main thread as before. A real browser, since jsdom has no Worker.
 */

import { Parser } from "@lezer/common";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { ReviewSession } from "@/components/review-session";
import type { Deck } from "@/lib/review/review";
import { cardsOf, cardsRead, readAside } from "@/lib/review/review-queue";
import "@/styles/app.css";

const FILLER = "Filler for a parse fixture, long enough to be a real deck. ".repeat(4);
const BIG = `#flashcards/big\n\n${Array.from({ length: 1500 }, (_, index) => {
  const n = index + 1;
  const schedule = n % 3 === 0 ? "" : " <!--SR:!2026-08-20,4,270-->";
  return `Question ${n}::Answer ${n}. ${FILLER}${schedule}`;
}).join("\n\n")}\n`;

// Comments hiding a tag, a fence, a cloze with its schedules, a parked card over
// several lines, and text beyond ASCII: what a parse can read differently.
const TRICKY = [
  "---",
  "id: tricky",
  "---",
  "#flashcards/big",
  "",
  "Plain::one <!--SR:!2026-08-20,4,270-->",
  "",
  "<!-- #flashcards/other",
  "Hidden::two -->",
  "",
  "```text",
  "Fenced::three",
  "```",
  "",
  "A {{c1::cloze}} with {{c2::two}} <!--SR:c1!2026-08-20,4,270--> <!--SR:c2!2026-08-22,6,250-->",
  "",
  "Over",
  "several lines",
  "?",
  "an answer",
  "!suspended",
  "",
  "Ünïcode 🙂::fünf `code::span` <!--SR:!2026-09-01,10,230-->",
  "",
].join("\n");

const DECK: Deck = {
  name: "big",
  notes: ["decks/big.md", "decks/tricky.md"],
  due: 1000,
  fresh: 500,
  parked: 0,
  whole: false,
  next: null,
};

const saved = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchNote: (path: string) =>
    path === "decks/big.md"
      ? Promise.resolve(BIG)
      : path === "decks/tricky.md"
        ? Promise.resolve(TRICKY)
        : Promise.reject(new Error(`GET /api/files/${path} failed with 404`)),
  saveNote: (path: string, content: string) => {
    saved.push(content);
    return Promise.resolve({ path, content });
  },
  fetchReviewLimits: () => Promise.reject(new Error("GET /api/review/limits failed with 404")),
}));

let root: Root | undefined;
let host: HTMLElement | undefined;
let parse: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  saved.length = 0;
  parse = vi.spyOn(Parser.prototype, "parse");
});

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The lezer parses of the big deck on this thread; the editor's own parses are small. */
function mainParses(): number {
  return parse.mock.calls.filter(
    ([input]: unknown[]) => typeof input === "string" && input.length > 100_000,
  ).length;
}

function mount(deck: Deck = DECK): HTMLElement {
  const div = document.body.appendChild(document.createElement("div"));
  div.className = "h-dvh w-full";
  host = div;
  root = createRoot(div);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSession deck={deck} onLeave={() => {}} />
    </QueryClientProvider>,
  );
  return div;
}

async function opened(screen: HTMLElement): Promise<void> {
  await expect
    .poll(() => screen.querySelector('[data-testid="review-card"] .cm-line'), { timeout: 30_000 })
    .not.toBeNull();
}

function button(screen: HTMLElement, selector: string): HTMLButtonElement {
  return screen.querySelector(selector) as HTMLButtonElement;
}

/** Grade good, suspend, then undo the suspend, and the texts each step sent. */
async function steps(): Promise<string[]> {
  const screen = mount();
  await opened(screen);
  for (const action of ["good", "park"]) {
    const sent = saved.length;
    button(screen, "footer button").click();
    await expect.poll(() => screen.querySelector('button[data-rating="good"]')).not.toBeNull();
    if (action === "good") button(screen, 'button[data-rating="good"]').click();
    else
      [...screen.querySelectorAll("button")]
        .find((each) => /park/i.test(each.textContent ?? ""))
        ?.click();
    await expect.poll(() => saved.length).toBe(sent + 1);
  }
  [...screen.querySelectorAll("button")]
    .find((each) => /undo/i.test(each.textContent ?? ""))
    ?.click();
  await expect.poll(() => saved.length).toBe(3);
  root?.unmount();
  root = undefined;
  return [...saved];
}

/** A Worker that never answers, so the parse stays out. */
class Silent {
  terminated = false;
  static made: Silent[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  constructor() {
    Silent.made.push(this);
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
}

it("#1359 I1 the worker reads the same cards, at the same lines, as the main-thread parse", async () => {
  const texts = new Map([
    ["decks/big.md", BIG],
    ["decks/tricky.md", TRICKY],
  ]);
  await readAside(DECK, texts, new AbortController().signal);
  const held = cardsOf(DECK, texts);
  // Held from the worker: reading them made no parse here.
  expect(mainParses()).toBe(0);
  expect(held).toEqual(cardsRead(DECK, texts));
  expect(held.get("decks/tricky.md")?.map((card) => [card.from, card.to])).toEqual(
    cardsRead(DECK, texts)
      .get("decks/tricky.md")
      ?.map((card) => [card.from, card.to]),
  );
  expect(held.get("decks/tricky.md")?.length).toBeGreaterThanOrEqual(4);
});

it("#1359 I2 I6 a grade, a suspend and an undo after a worker open write what a main-thread open writes", async () => {
  const viaWorker = await steps();
  expect(mainParses()).toBeGreaterThan(0);
  saved.length = 0;
  vi.stubGlobal("Worker", undefined);
  const viaMain = await steps();
  expect(viaWorker).toEqual(viaMain);
  // The undo puts the graded text back, which the suspend had moved on from.
  expect(viaWorker[2]).toBe(viaWorker[0]);
});

it("#1359 I3 with no Worker the sitting parses on the main thread and opens", async () => {
  vi.stubGlobal("Worker", undefined);
  await opened(mount());
  expect(mainParses()).toBe(1);
});

it("#1359 I3 a Worker that throws as it starts leaves the parse to the main thread", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new DOMException("Workers are refused", "SecurityError");
      }
    },
  );
  await opened(mount());
  expect(mainParses()).toBe(1);
});

it("#1359 I7 a sitting closed before the parse begins starts no worker", async () => {
  Silent.made = [];
  vi.stubGlobal("Worker", Silent);
  const closed = new AbortController();
  closed.abort();
  await readAside(DECK, new Map([["decks/big.md", BIG]]), closed.signal);
  expect(Silent.made).toHaveLength(0);
});

it("#1359 I4 a parse that fails in the worker falls back to the main-thread parse", async () => {
  class Failing extends Silent {
    override postMessage() {
      setTimeout(() => this.onerror?.(new ErrorEvent("error", { message: "parse failed" })));
    }
  }
  vi.stubGlobal("Worker", Failing);
  await opened(mount());
  expect(mainParses()).toBe(1);
});

it("#1359 I5 I7 while the parse is out the screen says Reading the deck, and closing it ends the worker", async () => {
  Silent.made = [];
  vi.stubGlobal("Worker", Silent);
  const screen = mount();
  await expect.poll(() => screen.textContent).toContain("Reading the deck…");
  expect(screen.querySelector('[data-testid="review-card"]')).toBeNull();
  expect(Silent.made).toHaveLength(1);
  root?.unmount();
  root = undefined;
  expect(Silent.made[0]?.terminated).toBe(true);
  expect(mainParses()).toBe(0);
});

it("#1359 I8 a whole-note deck opens without a worker", async () => {
  Silent.made = [];
  vi.stubGlobal("Worker", Silent);
  await opened(mount({ ...DECK, name: "decks/big", notes: ["decks/big.md"], whole: true }));
  expect(Silent.made).toHaveLength(0);
});
