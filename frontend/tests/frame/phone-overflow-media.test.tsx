/**
 * #793 A18: at 390 by 844 with touch, the vault graph, search, an HTML page, a
 * PDF, a book and a video fit the phone with no sideways scroll. Each is checked
 * in its own pane with the rule of phone-overflow-text.test.tsx: each
 * `.cm-scroller` and each other box that scrolls on its own must fit.
 *
 * Boxes that scroll sideways by design (a code block `pre`, a table's
 * `.cm-table-scroll`, the tab strip's tablist) are left out of the check.
 */

import "./html-take-api";
import "./pdf-take-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, waitFor } from "@testing-library/react";
import { act, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { NoteSearch } from "@/components/note-search";
import { PdfPane } from "@/components/pdf-pane";
import { fetchBook, fetchMentions, fetchTodos, type SearchHit, searchNotes } from "@/lib/api";
import plainUrl from "../fixtures/plain.epub?url";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { PLAIN as BOOK_PLAIN, mountBooks, paneOf, sectionOf } from "./book-take-fixture";
import { api, frameOf, ready, render, setUp, tearDown } from "./html-take-fixture";
import { PLAIN as HTML_PLAIN } from "./html-take-pages";
import { PAGE_ONE } from "./pdf-fixture";
import { PATIENCE, registerReaderFixture, TOUCH } from "./reader-fixture";
import {
  boxOf,
  DEV_ANSWER,
  mountPane,
  registerVaultFixture,
  serveGraph,
  setUp as setUpVault,
  untilCanvas,
  untilCounted,
  untilSized,
} from "./vault-graph-fixture";
import { registerNotes, renderPanes, TAKE, TALK, talkNote, VIDEO } from "./video-pane-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchBook: vi.fn(),
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchMentions: vi.fn(),
    fetchTodos: vi.fn(),
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

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

vi.mock("@/lib/video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video")>()),
  playerUrl: () => "about:blank",
}));

registerReaderFixture();
registerVaultFixture();
registerNotes({ [TALK]: talkNote(VIDEO, TAKE) });

afterEach(async () => {
  await commands.emulateMedia({});
});

const NOW = new Date(2026, 9, 23);
const HITS: SearchHit[] = [
  {
    path: "Notes/Postgres.md",
    line: 3,
    text: "postgres takes indexes in stride",
    date: "2026-10-22",
    tags: [],
  },
];
const HTML_PATH = "take/phone.html";
const PDF_PATH = "take/plan.pdf";
const BOOK_NOTE = "20 Literature/Plain.md";
const WORDS = PAGE_ONE[0] ?? "";

/** The phone: 390 by 844 with a finger, which the app reads as a narrow window and a coarse pointer. */
async function phone() {
  await page.viewport(390, 844);
  await commands.emulateMedia({
    touch: true,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
}

/** The boxes that scroll sideways, outside the ones made to, named by tag and class. */
function sidewaysIn(root: HTMLElement): string[] {
  return [root, ...root.querySelectorAll<HTMLElement>("*")]
    .filter((el) => el.closest(".cm-table-scroll, [role='tablist'], pre") === null)
    .filter((el) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX))
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`);
}

/** Each pane's `.cm-scroller` and each other scroll box fit 390, and the page does too. */
function expectFits(host: HTMLElement) {
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  for (const scroller of host.querySelectorAll<HTMLElement>(".cm-scroller")) {
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth + 1);
  }
  expect(sidewaysIn(host)).toEqual([]);
}

/** The search page: the same component the app mounts, holding its week as the route does. */
function SearchPage({ client }: { client: QueryClient }) {
  const [week, setWeek] = useState<string | undefined>();
  return (
    <QueryClientProvider client={client}>
      <NoteSearch
        onOpen={() => {}}
        onClose={() => {}}
        archive={false}
        now={NOW}
        week={week}
        onWeek={setWeek}
      />
    </QueryClientProvider>
  );
}

describe("#793 A18 the media panes do not overflow sideways", () => {
  it("#793 A18 at 390 vault graph does not overflow sideways", async () => {
    await setUpVault(TOUCH, "light");
    await phone();
    serveGraph(DEV_ANSWER);
    const host = boxOf(390, 844);
    await mountPane(host);
    await untilCanvas(host);
    await untilCounted(host);
    await untilSized(host);
    expectFits(host);
  });

  it("#793 A18 at 390 search does not overflow sideways", async () => {
    await phone();
    vi.mocked(searchNotes).mockResolvedValue(HITS);
    vi.mocked(fetchMentions).mockResolvedValue([]);
    vi.mocked(fetchTodos).mockResolvedValue([]);
    const host = document.body.appendChild(document.createElement("div"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<SearchPage client={client} />);
      });
      fireEvent.change(host.querySelector("input") as HTMLInputElement, {
        target: { value: "postgres" },
      });
      await waitFor(
        () => expect(host.querySelectorAll('[role="option"]').length).toBeGreaterThan(0),
        PATIENCE,
      );
      expectFits(host);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("#793 A18 at 390 HTML page does not overflow sideways", async () => {
    const mounted = await setUp();
    try {
      await phone();
      await commands.servePage(HTML_PATH, HTML_PLAIN);
      render(mounted, [HTML_PATH], true);
      await ready(frameOf(mounted, 0));
      expectFits(mounted.host);
      // A sandboxed frame may give no document to read, so its box is the check above.
      const inner = frameOf(mounted, 0).contentDocument;
      if (inner) expect(inner.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    } finally {
      await tearDown(mounted);
    }
  });

  it("#793 A18 at 390 PDF does not overflow sideways", async () => {
    const mounted = await setUp();
    try {
      await phone();
      flushSync(() =>
        mounted.root.render(
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            <div className="flex h-dvh flex-row">
              <div data-pane className="flex min-w-0 flex-1 flex-col">
                <PdfPane
                  path={PDF_PATH}
                  opened={1}
                  commands={mounted.spy}
                  focusSignal={1}
                  onNoteBeside={() => {}}
                />
              </div>
            </div>
          </QueryClientProvider>,
        ),
      );
      await vi.waitFor(
        () =>
          expect(
            [...mounted.host.querySelectorAll('[data-pdf-page="1"] .textLayer span')].some((span) =>
              (span.textContent ?? "").includes(WORDS),
            ),
          ).toBe(true),
        { timeout: 20_000 },
      );
      expectFits(mounted.host);
    } finally {
      await tearDown(mounted);
    }
  });

  it("#793 A18 at 390 book does not overflow sideways", async () => {
    const mounted = await setUp();
    try {
      await phone();
      api.notes[BOOK_NOTE] = BOOK_PLAIN;
      vi.mocked(fetchBook).mockResolvedValue({
        path: BOOK_NOTE.replace(/\.md$/, ".epub"),
        blob: await (await fetch(plainUrl)).blob(),
      });
      mountBooks(mounted, [BOOK_NOTE]);
      await sectionOf(BOOK_NOTE);
      expect(paneOf(mounted, BOOK_NOTE)).not.toBeNull();
      expectFits(mounted.host);
    } finally {
      await tearDown(mounted);
    }
  });

  it("#793 A18 at 390 video does not overflow sideways", async () => {
    const mounted = await setUp();
    try {
      await phone();
      renderPanes(mounted, [{ note: TALK }]);
      await vi.waitFor(
        () => expect(mounted.host.querySelector("[data-video-pane]")).not.toBeNull(),
        { timeout: 20_000 },
      );
      expectFits(mounted.host);
    } finally {
      await tearDown(mounted);
    }
  });
});
