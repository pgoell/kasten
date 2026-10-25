/**
 * The periodic reviews in a real browser (#807): layout, touch, mouse, reduced motion and the
 * no-write rule. On a phone by touch, one column, nothing sideways, rows 44 px tall, and a tap
 * opens a note at its line. On a desktop, the numbers beside the main column and a click opens a
 * note. Opening, scrolling and leaving the yearly note writes nothing. jsdom lays nothing out,
 * so each is measured here. The typing and the vim tests are in periodic-review-editing.test.tsx.
 */

import { userEvent } from "vitest/browser";
import {
  cursorLine,
  drawn,
  installReads,
  inView,
  mountAt,
  restoreFrame,
  rowNamed,
  SilentEventSource,
  stubReviewFetch,
  tap,
  textOf,
  WEEK_ROUTE,
  writes,
  YEAR_ROUTE,
} from "./periodic-review-fixture";
import { DESKTOP, need, nextFrame, PATIENCE, scrollerOf, TOUCH, unmount } from "./reader-fixture";

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

it("#807 A9 at 390x844 by touch the yearly review stands in one column, nothing scrolls sideways, and the note's own line is reachable below it", async () => {
  const mounted = await mountAt(TOUCH, YEAR_ROUTE, {}, "no-preference");
  try {
    const { host } = mounted;
    await drawn(host, "Year in review");

    const main = need(host.querySelector<HTMLElement>(".review-main"), "the main column");
    const aside = need(host.querySelector<HTMLElement>(".review-aside"), "the numbers");
    const mainBox = main.getBoundingClientRect();
    const asideBox = aside.getBoundingClientRect();
    expect(asideBox.left, "the numbers sit in the main column's column").toBe(mainBox.left);
    expect(
      asideBox.bottom <= mainBox.top || mainBox.bottom <= asideBox.top,
      "the numbers and the main column stack",
    ).toBe(true);
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );

    const scroller = scrollerOf(host);
    scroller.scrollTop = scroller.scrollHeight;
    await expect.poll(() => inView(host, "my own line"), PATIENCE).toBe(true);
  } finally {
    await unmount(mounted);
  }
});

it("#807 I7 at 390x844 by touch every row of the week review is 44 px tall and a tap on a done row opens its note at its line", async () => {
  const mounted = await mountAt(TOUCH, WEEK_ROUTE, {}, "no-preference");
  try {
    const { host } = mounted;
    await drawn(host, "Week in review");

    const rows = [...host.querySelectorAll<HTMLElement>(".review-row")];
    expect(rows.length, "the done and carried over rows").toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.getBoundingClientRect().height, row.textContent ?? "").toBeGreaterThanOrEqual(44);
    }

    await tap(rowNamed(host, "ship the export"));
    await expect.poll(() => textOf(host), PATIENCE).toContain("- [x] ship the export");
    expect(cursorLine(host)).toContain("ship the export");
  } finally {
    await unmount(mounted);
  }
});

it("#807 A9 at 1440x900 the yearly review puts the numbers in an aside beside the main column", async () => {
  const mounted = await mountAt(DESKTOP, YEAR_ROUTE, {}, "no-preference");
  try {
    const { host } = mounted;
    await drawn(host, "Year in review");

    const main = need(host.querySelector<HTMLElement>(".review-main"), "the main column");
    const aside = need(host.querySelector<HTMLElement>(".review-aside"), "the numbers");
    expect(
      aside.getBoundingClientRect().left,
      "the numbers start past the main column",
    ).toBeGreaterThanOrEqual(main.getBoundingClientRect().right);
  } finally {
    await unmount(mounted);
  }
});

it("#807 A9 at 1440x900 a click on a done row of the week review opens its note at its line", async () => {
  const mounted = await mountAt(DESKTOP, WEEK_ROUTE, {}, "no-preference");
  try {
    const { host } = mounted;
    await drawn(host, "Week in review");

    await userEvent.click(rowNamed(host, "ship the export"));
    await expect.poll(() => textOf(host), PATIENCE).toContain("- [x] ship the export");
    expect(cursorLine(host)).toContain("ship the export");
  } finally {
    await unmount(mounted);
  }
});

it("#807 A9 with reduced motion on the review block animates nothing", async () => {
  const mounted = await mountAt(DESKTOP, YEAR_ROUTE, {}, "reduce");
  try {
    const block = await drawn(mounted.host, "Year in review");
    expect(block.getAnimations({ subtree: true }).length, "animations running in the block").toBe(
      0,
    );
    await nextFrame();
    expect(block.getAnimations({ subtree: true }).length, "animations running in the block").toBe(
      0,
    );
  } finally {
    await unmount(mounted);
  }
});

it("#807 A1 opening, scrolling and leaving the yearly note sends no write", async () => {
  const mounted = await mountAt(DESKTOP, YEAR_ROUTE, {}, "no-preference");
  const { host } = mounted;
  await drawn(host, "Year in review");

  const scroller = scrollerOf(host);
  scroller.scrollTop = scroller.scrollHeight;
  await nextFrame();
  scroller.scrollTop = 0;
  await nextFrame();

  await unmount(mounted);
  expect(writes(), "requests that wrote").toEqual([]);
  expect(mocks.saveNote).not.toHaveBeenCalled();
  expect(mocks.updateNote).not.toHaveBeenCalled();
});
