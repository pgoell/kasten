/**
 * Pictures of the phone at 390 by 844 with touch (#793 A24): two notes split,
 * a flashcard question and its answer, and a note with eight tabs in the three
 * other palettes. Skipped unless VITE_KASTEN_SHOTS is set; pictures land in
 * node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { ReviewSession } from "@/components/review-session";
import { fetchNote } from "@/lib/api";
import { openInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, goToTab, type Layout, splitFocused } from "@/lib/panes";
import type { Deck } from "@/lib/review/review";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import {
  nextFrame,
  PATIENCE,
  picture,
  READER,
  registerReaderFixture,
  TOUCH,
  unmount,
} from "./reader-fixture";
import { shot } from "./shots";
import { DESIGN, LONG, mountTabs, registerTabNotes, wrappers } from "./tab-strip-fixture";
import "@/styles/app.css";

const SHOTS = Boolean(import.meta.env.VITE_KASTEN_SHOTS);

// The notes the review screens read, set per picture. The mocks read them lazily.
const vault = vi.hoisted(() => ({ notes: {} as Record<string, string> }));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchCards: () =>
      Promise.resolve(
        Object.entries(vault.notes).flatMap(([path, text]) =>
          text.split("\n").map((line, at) => ({ path, line: at + 1, text: line })),
        ),
      ),
    saveNote: async (path: string, content: string) => ({ path, content }),
    fetchReviewLimits: () => Promise.reject(new Error("GET /api/review/limits failed with 404")),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

const CLOZE = {
  "geography.md": "#flashcards/geography\n\nThe capital of {{c1::France}} is Paris.\n",
};
const BASIC = {
  "aws.md": "#flashcards/aws\n\nWhat is a VPC?::A private cloud <!--SR:!2026-10-24,5,250-->\n",
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

const SPLIT = openInFocused(splitFocused(emptyLayout(READER), "row"), DESIGN);

/** Eight tabs, one long note each, the first one active. */
function eightTabs(): Layout {
  const [first = LONG[0], ...rest] = LONG.slice(0, 8);
  return goToTab(
    rest.reduce((layout, path) => openInFocused(addTab(layout), path), emptyLayout(first)),
    0,
  );
}

/** Shows the answer by a click on the footer, the way a finger does it. */
async function answer(host: HTMLElement): Promise<void> {
  fireEvent.click(host.querySelector("footer button") as HTMLButtonElement);
  await expect.poll(() => host.querySelector('button[data-rating="good"]')).not.toBeNull();
}

/** One review picture at phone size: the screen mounted, settled, shot as `name`. */
async function reviewShot(
  name: string,
  notes: Record<string, string>,
  screen: ReactElement,
  theme: Theme,
  settle: (host: HTMLElement) => Promise<void>,
): Promise<void> {
  vault.notes = notes;
  await page.viewport(TOUCH.width, TOUCH.height);
  await commands.emulateMedia({
    touch: true,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  document.documentElement.dataset.theme = theme;

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh w-full";
  const root = createRoot(host);
  // In a `finally`, so a failed picture does not leave its host to the next.
  try {
    root.render(<QueryClientProvider client={new QueryClient()}>{screen}</QueryClientProvider>);
    await settle(host);
    await nextFrame();
    expect(await shot(host, name)).toBe(TOUCH.width);
  } finally {
    root.unmount();
    host.remove();
  }
}

describe("phone split and tabs", () => {
  registerReaderFixture();
  registerTabNotes();

  for (const theme of ["light", "dark"] as const) {
    it.skipIf(!SHOTS)(
      `#793 A24 phone-split-390-${theme}`,
      async () => {
        const mounted = await mountTabs(TOUCH, theme, SPLIT);
        try {
          await picture(mounted.host, `phone-split-390-${theme}`, TOUCH);
        } finally {
          await unmount(mounted);
        }
      },
      120_000,
    );
  }

  for (const palette of ["russet", "peach", "pansy"] as const) {
    it.skipIf(!SHOTS)(
      `#793 A24 phone-tabs-8-390-${palette}`,
      async () => {
        const mounted = await mountTabs(TOUCH, "light", eightTabs());
        try {
          // The palette is read from storage, so it is set and applied after the mount.
          localStorage.setItem(THEME_KEY, "light");
          localStorage.setItem(PALETTE_KEY, palette);
          applyTheme();
          await nextFrame();
          expect(document.documentElement.dataset.palette).toBe(palette);
          await expect.poll(() => wrappers(mounted.host).length, PATIENCE).toBe(8);
          await picture(mounted.host, `phone-tabs-8-390-${palette}`, TOUCH);
        } finally {
          await unmount(mounted);
        }
      },
      120_000,
    );
  }
});

describe("phone review", () => {
  beforeEach(() => {
    // The review screens read their notes from `vault`, so the note reads answer from it too.
    vi.mocked(fetchNote).mockImplementation(async (path: string) => {
      if (!(path in vault.notes)) throw new Error(`GET /api/files/${path} failed with 404`);
      return vault.notes[path] as string;
    });
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
    localStorage.clear();
    await commands.emulateMedia({});
    await page.viewport(1280, 900);
  });

  for (const theme of ["light", "dark"] as const) {
    it.skipIf(!SHOTS)(`#793 A24 phone-review-question-390-${theme}`, () =>
      reviewShot(
        `phone-review-question-390-${theme}`,
        CLOZE,
        <ReviewSession deck={GEOGRAPHY} onLeave={() => {}} />,
        theme,
        async (host) => {
          await expect.poll(() => host.querySelector("[data-gap]")).not.toBeNull();
        },
      ),
    );

    it.skipIf(!SHOTS)(`#793 A24 phone-review-answer-390-${theme}`, () =>
      reviewShot(
        `phone-review-answer-390-${theme}`,
        BASIC,
        <ReviewSession deck={AWS} onLeave={() => {}} />,
        theme,
        async (host) => {
          await expect
            .poll(() => host.querySelector('[data-testid="review-card"] .cm-line'))
            .not.toBeNull();
          await answer(host);
        },
      ),
    );
  }
});
