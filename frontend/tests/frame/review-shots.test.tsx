/**
 * Pictures of the flashcard screens (#790), to look at by eye: the deck list,
 * a cloze question, a basic answer, the answer mid-swipe on a phone, and the
 * done screen, each in light and dark at desktop and phone width, with the
 * answer in the other three palettes.
 *
 * The clock is fixed to Saturday 2026-10-24, so "next Thursday" and the
 * intervals hold still. Skipped unless VITE_KASTEN_SHOTS is set; pictures land
 * in node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { ReviewDecks } from "@/components/review-decks";
import { ReviewSession } from "@/components/review-session";
import type { Deck } from "@/lib/review/review";
import type { Palette, Theme } from "@/lib/theme";
import { shot } from "./shots";
import "@/styles/app.css";

const SHOTS = Boolean(import.meta.env.VITE_KASTEN_SHOTS);
const DESKTOP = { width: 1440, height: 900, touch: false };
const PHONE = { width: 414, height: 896, touch: true };
type Size = typeof DESKTOP;

// The notes the screen reads, set per picture. The mock reads them lazily.
const vault = vi.hoisted(() => ({ notes: {} as Record<string, string> }));

// The reads the screens make, answered from `vault` and no server. The rest
// kept, as the browser checks every named import the graph holds.
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchCards: () =>
    Promise.resolve(
      Object.entries(vault.notes).flatMap(([path, text]) =>
        text.split("\n").map((line, at) => ({ path, line: at + 1, text: line })),
      ),
    ),
  fetchNote: (path: string) =>
    path in vault.notes
      ? Promise.resolve(vault.notes[path] as string)
      : Promise.reject(new Error(`GET /api/files/${path} failed with 404`)),
  saveNote: (path: string, content: string) => Promise.resolve({ path, content }),
  fetchReviewLimits: () => Promise.reject(new Error("GET /api/review/limits failed with 404")),
}));

/** Three decks: one due and new with a subdeck, one only new, one with nothing due next Thursday and parked cards. */
const DECKS = {
  "aws.md": [
    "#flashcards/aws",
    "",
    "What is a VPC?::A private cloud <!--SR:!2026-10-23,3,250-->",
    "",
    "What does S3 stand for?::Simple Storage Service",
  ].join("\n"),
  "aws-networking.md": [
    "#flashcards/aws/networking",
    "",
    "What is a subnet?::A slice of a VPC <!--SR:!2026-10-22,2,250-->",
  ].join("\n"),
  "spanish.md": ["#flashcards/spanish", "", "Hola::Hello", "", "Gracias::Thank you"].join("\n"),
  "databases.md": [
    "#flashcards/databases",
    "",
    "What is MVCC?::A row per version !suspended",
    "",
    "What is an index?::A sorted copy of a column !suspended",
    "",
    "What is the WAL?::The write-ahead log <!--SR:!2026-10-29,6,260-->",
  ].join("\n"),
};

/** A cloze card, so the gap pill shows on the question side. */
const CLOZE = {
  "geography.md": "#flashcards/geography\n\nThe capital of {{c1::France}} is Paris.\n",
};

/** A basic card last answered five days ago, so the intervals and the source line show. */
const BASIC = {
  "aws.md": "#flashcards/aws\n\nWhat is a VPC?::A private cloud <!--SR:!2026-10-24,5,250-->\n",
};

/** One card, so the done screen is the one after the last card. */
const LONE = {
  "lone.md": "#flashcards/lone\n\nWhat is IAM?::Identity and access management\n",
};

const AWS: Deck = {
  name: "aws",
  notes: ["aws.md"],
  due: 1,
  fresh: 0,
  parked: 0,
  whole: false,
  next: null,
};
const GEOGRAPHY: Deck = {
  name: "geography",
  notes: ["geography.md"],
  due: 0,
  fresh: 1,
  parked: 0,
  whole: false,
  next: null,
};
const LONE_DECK: Deck = {
  name: "lone",
  notes: ["lone.md"],
  due: 0,
  fresh: 1,
  parked: 0,
  whole: false,
  next: null,
};

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The sitting's host: the card a finger lands on, which the swipe root holds. */
const cardOf = (screen: HTMLElement) =>
  screen.querySelector<HTMLElement>('[data-testid="review-card"]') as HTMLElement;

/** Shows the answer by a click on the footer, the way a mouse does it. */
async function answer(host: HTMLElement): Promise<void> {
  (host.querySelector("footer button") as HTMLButtonElement).click();
  await expect.poll(() => host.querySelector('button[data-rating="good"]')).not.toBeNull();
}

/** A finger drawn sideways across the card by `dx` px, a frame a move, and left held down at the end. */
async function slide(target: Element, dx: number, moves: number): Promise<void> {
  const box = target.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  const at = (type: "pointerdown" | "pointermove", px: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 3,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: px,
        clientY: y,
        bubbles: true,
        cancelable: true,
      }),
    );
  at("pointerdown", x);
  for (let step = 1; step <= moves; step++) {
    await nextFrame();
    at("pointermove", x + (dx * step) / moves);
  }
}

interface Scene {
  vault: Record<string, string>;
  mount: () => ReactElement;
  /** Puts the screen in the state the picture shows, and waits for it. */
  settle: (host: HTMLElement) => Promise<void>;
}

const SCENES = {
  decks: {
    vault: DECKS,
    mount: () => <ReviewDecks onPick={() => {}} onParked={() => {}} />,
    settle: async (host) => {
      await expect.poll(() => host.querySelector("[data-start]")).not.toBeNull();
    },
  },
  question: {
    vault: CLOZE,
    mount: () => <ReviewSession deck={GEOGRAPHY} onLeave={() => {}} />,
    settle: async (host) => {
      await expect.poll(() => host.querySelector("[data-gap]")).not.toBeNull();
    },
  },
  answer: {
    vault: BASIC,
    mount: () => <ReviewSession deck={AWS} onLeave={() => {}} />,
    settle: async (host) => {
      await expect
        .poll(() => host.querySelector('[data-testid="review-card"] .cm-line'))
        .not.toBeNull();
      await answer(host);
    },
  },
  swipe: {
    vault: BASIC,
    mount: () => <ReviewSession deck={AWS} onLeave={() => {}} />,
    settle: async (host) => {
      await expect
        .poll(() => host.querySelector('[data-testid="review-card"] .cm-line'))
        .not.toBeNull();
      await answer(host);
      // Held at 120 px, the Good stamp fading in over the card.
      await slide(cardOf(host), 120, 6);
      await expect
        .poll(() =>
          Number(getComputedStyle(host.querySelector('[data-stamp="good"]') as Element).opacity),
        )
        .toBeGreaterThan(0);
    },
  },
  done: {
    vault: LONE,
    mount: () => <ReviewSession deck={LONE_DECK} onLeave={() => {}} />,
    settle: async (host) => {
      await expect
        .poll(() => host.querySelector('[data-testid="review-card"] .cm-line'))
        .not.toBeNull();
      await answer(host);
      (host.querySelector('button[data-rating="good"]') as HTMLButtonElement).click();
      await expect.poll(() => host.querySelector('[data-testid="review-done"]')).not.toBeNull();
    },
  },
} satisfies Record<string, Scene>;

type Screen = keyof typeof SCENES;

/** One picture: the screen at `size`, `theme` and `palette`, saved as `name`, its width checked. */
async function picture(
  name: string,
  screen: Screen,
  size: Size,
  theme: Theme,
  palette: Palette,
): Promise<void> {
  const scene: Scene = SCENES[screen];
  vault.notes = scene.vault;
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.touch,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette = palette;

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh w-full";
  const root = createRoot(host);
  // In a `finally`, so a failed picture does not leave its host or clock to the next.
  try {
    root.render(
      <QueryClientProvider client={new QueryClient()}>{scene.mount()}</QueryClientProvider>,
    );
    await scene.settle(host);
    await nextFrame();
    expect(await shot(host, name)).toBe(size.width);
  } finally {
    root.unmount();
    host.remove();
  }
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 24, 10, 0));
  // A synthetic pointer is no active pointer, so the browser refuses the capture a finger would hold.
  vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
  localStorage.clear();
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
});

/** The pictures, each a test of its own so one can be run by its name. */
const PICTURES: { screen: Screen; size: Size; theme: Theme; palette?: Palette }[] = [];
for (const screen of ["decks", "question", "answer", "done"] as const) {
  for (const size of [DESKTOP, PHONE]) {
    for (const theme of ["light", "dark"] as const) PICTURES.push({ screen, size, theme });
  }
}
for (const theme of ["light", "dark"] as const) {
  PICTURES.push({ screen: "swipe", size: PHONE, theme });
}
for (const palette of ["russet", "peach", "pansy"] as const) {
  PICTURES.push({ screen: "answer", size: DESKTOP, theme: "light", palette });
}

for (const { screen, size, theme, palette = "poel" } of PICTURES) {
  const name = `review-${screen}-${size.width}-${theme}${palette === "poel" ? "" : `-${palette}`}`;
  it.skipIf(!SHOTS)(name, () => picture(name, screen, size, theme, palette), 120_000);
}
