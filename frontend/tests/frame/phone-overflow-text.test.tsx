/**
 * #793 A18: at 390 by 844 with touch, no text screen of the phone frame scrolls
 * sideways. The screens are home, a note, a split of two notes, a wide table
 * note, and a review question and its answer.
 *
 * Three boxes scroll sideways by design and are left out of the check: a table's
 * `.cm-table-scroll` (the table scrolls in its own box), the tab strip's tablist,
 * and code blocks (`pre`). Everything else must fit: the page, `main`, each
 * `.cm-scroller`, and any other box that scrolls on its own.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { ReviewSession } from "@/components/review-session";
import { fetchCards, fetchNote, fetchReviewLimits, NoteMissing } from "@/lib/api";
import { openInFocused } from "@/lib/pane-contents";
import { emptyLayout, splitFocused } from "@/lib/panes";
import type { Deck } from "@/lib/review";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import {
  mount,
  mountNote,
  mountToday,
  PATIENCE,
  READER,
  registerReaderFixture,
  TOUCH,
  unmount,
} from "./reader-fixture";
import { DESIGN, mountTabs, registerTabNotes } from "./tab-strip-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchMentions: vi.fn(),
    fetchCards: vi.fn(),
    fetchReviewLimits: vi.fn(),
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

registerReaderFixture();
registerTabNotes();

const WIDE = "02 Projects/Kasten/Wide.md";

/** A note with a line above a table of `rows` body rows and `columns` columns. */
function wideNote(rows: number, columns = 30): string {
  const cell = (text: string) => ` ${text} |`;
  const header = `|${Array.from({ length: columns }, (_, c) => cell(`column ${c}`)).join("")}`;
  const divider = `|${" --- |".repeat(columns)}`;
  const body = Array.from(
    { length: rows },
    (_, r) =>
      `|${Array.from({ length: columns }, (_, c) =>
        cell(c === 0 ? `item ${r}` : c === 1 ? `${r * 10}` : `cell ${r} ${c}`),
      ).join("")}`,
  );
  return ["before", "", header, divider, ...body].join("\n");
}

/** The boxes that scroll sideways, outside the ones made to, named by tag and class. */
function sidewaysIn(root: HTMLElement): string[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")]
    .filter((el) => el.closest(".cm-table-scroll, [role='tablist'], pre") === null)
    .filter((el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX))
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`);
}

/** The page, `main`, each pane's `.cm-scroller` and each other scroll box all fit 390. */
function expectFits(host: HTMLElement) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  const main = document.querySelector("main");
  if (main) expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
  for (const scroller of host.querySelectorAll<HTMLElement>(".cm-scroller")) {
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
  }
  expect(sidewaysIn(host)).toEqual([]);
}

/** Mounts one review screen at the phone's size in touch, settles it, and checks it fits. */
async function reviewFits(
  deck: Deck,
  path: string,
  text: string,
  settle: (host: HTMLElement) => Promise<void>,
) {
  await page.viewport(390, 844);
  await commands.emulateMedia({
    touch: true,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  vi.mocked(fetchCards).mockResolvedValue(
    text.split("\n").map((line, at) => ({ path, line: at + 1, text: line })),
  );
  // The screen reads the card's note as well as the card list, so the note answers its text.
  vi.mocked(fetchNote).mockImplementation(async (name: string) => {
    if (name !== path) throw new NoteMissing(name);
    return text;
  });
  vi.mocked(fetchReviewLimits).mockRejectedValue(
    new Error("GET /api/review/limits failed with 404"),
  );

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh w-full";
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ReviewSession deck={deck} onLeave={() => {}} />
        </QueryClientProvider>,
      );
    });
    await settle(host);
    expectFits(host);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    await commands.emulateMedia({});
  }
}

const GEOGRAPHY: Deck = {
  name: "geography",
  notes: ["geography.md"],
  due: 0,
  fresh: 1,
  parked: 0,
  whole: false,
  next: null,
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

describe("#793 A18 the phone frame does not overflow sideways", () => {
  it("#793 A18 at 390 home does not overflow sideways", async () => {
    const mounted = await mountToday(TOUCH, "light");
    try {
      expectFits(mounted.host);
    } finally {
      await unmount(mounted);
    }
  });

  it("#793 A18 at 390 note does not overflow sideways", async () => {
    const mounted = await mountNote(TOUCH, "light");
    try {
      expectFits(mounted.host);
    } finally {
      await unmount(mounted);
    }
  });

  it("#793 A18 at 390 split does not overflow sideways", async () => {
    // One pane or two at this width is another change's call, so only the overflow is checked.
    const layout = openInFocused(splitFocused(emptyLayout(READER), "row"), DESIGN);
    const mounted = await mountTabs(TOUCH, "light", layout);
    try {
      expectFits(mounted.host);
    } finally {
      await unmount(mounted);
    }
  });

  it("#793 A18 at 390 wide table does not overflow sideways", async () => {
    // The table scrolls in its own box, which sidewaysIn leaves out, so the page must still fit.
    const previous = vi.mocked(fetchNote).getMockImplementation();
    vi.mocked(fetchNote).mockImplementation(async (path: string) => {
      if (path === WIDE) return wideNote(3);
      if (!previous) throw new NoteMissing(path);
      return previous(path);
    });
    const mounted = await mount(
      TOUCH,
      "light",
      `/?note=${encodeURIComponent(WIDE)}`,
      "[data-reader-grid]",
    );
    try {
      await waitFor(
        () => expect(mounted.host.querySelector(".cm-table-block")).not.toBeNull(),
        PATIENCE,
      );
      expectFits(mounted.host);
    } finally {
      await unmount(mounted);
    }
  });

  it("#793 A18 at 390 review question does not overflow sideways", async () => {
    await reviewFits(
      GEOGRAPHY,
      "geography.md",
      "#flashcards/geography\n\nThe capital of {{c1::France}} is Paris.\n",
      async (host) => {
        await expect.poll(() => host.querySelector("[data-gap]")).not.toBeNull();
      },
    );
  });

  it("#793 A18 at 390 review answer does not overflow sideways", async () => {
    await reviewFits(
      AWS,
      "aws.md",
      "#flashcards/aws\n\nWhat is a VPC?::A private cloud <!--SR:!2026-10-24,5,250-->\n",
      async (host) => {
        await expect
          .poll(() => host.querySelector('[data-testid="review-card"] .cm-line'))
          .not.toBeNull();
        (host.querySelector("footer button") as HTMLButtonElement).click();
        await expect.poll(() => host.querySelector('button[data-rating="good"]')).not.toBeNull();
      },
    );
  });
});
