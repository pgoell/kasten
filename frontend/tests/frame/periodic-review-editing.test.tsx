/**
 * Typing under the periodic review in a real browser (#807). With vim on, the cursor passes the
 * block and typing edits the user's line; with vim off, a click on the user's line and typing
 * edit it in Read and in Edit. The block's words never reach the file. jsdom lays nothing out,
 * so the cursor and the clicks are measured here.
 */

import { userEvent } from "vitest/browser";
import {
  cursorLine,
  drawn,
  installReads,
  lastSaved,
  lineNamed,
  mountAt,
  restoreFrame,
  reveal,
  SilentEventSource,
  stubReviewFetch,
  textOf,
  VIM,
  YEAR,
  YEAR_ROUTE,
} from "./periodic-review-fixture";
import { DESKTOP, need, unmount, visibleEditor } from "./reader-fixture";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchFiles: mocks.fetchFiles,
  fetchNote: mocks.fetchNote,
  saveNote: mocks.saveNote,
  updateNote: mocks.updateNote,
  fetchTodos: mocks.fetchTodos,
  fetchCards: mocks.fetchCards,
  fetchWritten: mocks.fetchWritten,
  searchNotes: async () => [],
  fetchImages: async () => [],
  fetchHtml: async () => [],
  fetchAssets: async () => [],
  fetchTags: async () => [],
  fetchTerminals: async () => [],
  fetchVersion: async () => "0.8.0",
  fetchWeather: async () => [],
}));

vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog: mocks.fetchLog,
}));

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

// The api and food reads are doubles, and `vi.mock` hoists above the imports, so they live in
// one hoisted object the factories and the beforeEach both reach.
const mocks = vi.hoisted(() => {
  const fetchNote = vi.fn();
  const saveNote = vi.fn(async (path: string, content: string) => ({ path, content }));
  return {
    fetchNote,
    saveNote,
    updateNote: vi.fn(async (path: string, change: (text: string) => string | null) => {
      const next = change((await fetchNote(path)) as string);
      return next === null ? null : saveNote(path, next);
    }),
    fetchFiles: vi.fn(),
    fetchTodos: vi.fn(),
    fetchCards: vi.fn(),
    fetchWritten: vi.fn(),
    fetchLog: vi.fn(),
  };
});

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
  stubReviewFetch();
  installReads(mocks);
  mocks.saveNote.mockClear();
  mocks.updateNote.mockClear();
});

afterEach(restoreFrame);

it("#807 I6 with vim on, j from the title lands on the first line below the block, k goes back, and typing edits that line and never the block", async () => {
  const mounted = await mountAt(DESKTOP, YEAR_ROUTE, {}, "no-preference");
  try {
    const { host } = mounted;
    await drawn(host, "Year in review");

    visibleEditor(host).focus();
    await userEvent.keyboard("gg");
    expect(cursorLine(host)).toBe(`# ${YEAR}`);

    await userEvent.keyboard("j");
    expect(cursorLine(host), "the first line below the block").toBe("my own line");
    await userEvent.keyboard("k");
    expect(cursorLine(host)).toBe(`# ${YEAR}`);

    // `gg` leaves the cursor on the title's first word, so `0` takes it to the line's start first.
    await userEvent.keyboard("j");
    await userEvent.keyboard("0");
    await userEvent.keyboard("i");
    await userEvent.keyboard("Hello ");
    await userEvent.keyboard("{Escape}");

    expect(textOf(host)).toBe(`# ${YEAR}\nHello my own line\n`);
    expect(textOf(host)).not.toContain("Year in review");
    await expect
      .poll(() => lastSaved(mocks.saveNote), { timeout: 10_000 })
      .toContain("Hello my own line");
    expect(lastSaved(mocks.saveNote)).not.toContain("Year in review");
  } finally {
    await unmount(mounted);
  }
});

it("#807 I6 with vim off a click on the user's line and typing edit it in Read and in Edit", async () => {
  const mounted = await mountAt(DESKTOP, YEAR_ROUTE, { [VIM]: "off" }, "no-preference");
  try {
    const { host } = mounted;
    await drawn(host, "Year in review");

    // Read is the reader's own view, where the line the cursor is on shows its source.
    await reveal(host, "my own line");
    await userEvent.click(need(lineNamed(host, "my own line"), "the user's line"));
    await userEvent.keyboard("{End}");
    await userEvent.keyboard(" read");
    expect(textOf(host)).toBe(`# ${YEAR}\nmy own line read\n`);

    // Vim off has no leader, so live preview is switched off from the command palette.
    await userEvent.keyboard("{Control>}{Shift>}P{/Shift}{/Control}");
    await userEvent.keyboard("live preview");
    await userEvent.keyboard("{Enter}");
    await drawn(host, "Year in review");

    await reveal(host, "my own line read");
    await userEvent.click(need(lineNamed(host, "my own line read"), "the user's line in Edit"));
    await userEvent.keyboard("{End}");
    await userEvent.keyboard(" edit");
    expect(textOf(host)).toBe(`# ${YEAR}\nmy own line read edit\n`);
    expect(textOf(host)).not.toContain("Year in review");
  } finally {
    await unmount(mounted);
  }
});
