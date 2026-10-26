/**
 * The periodic reviews in a real browser (#807): layout, touch, mouse, reduced motion and the
 * no-write rule. On a phone by touch, one column, nothing sideways, rows 44 px tall, and a tap
 * opens a note at its line. On a desktop, the numbers beside the main column and a click opens a
 * note. Opening, scrolling and leaving the yearly note writes nothing. jsdom lays nothing out,
 * so each is measured here. The typing and the vim tests are in periodic-review-editing.test.tsx.
 */

import { userEvent } from "vitest/browser";
import {
  answerModelUse,
  cursorLine,
  drawn,
  installReads,
  inView,
  MODEL_USE,
  mountAt,
  restoreFrame,
  rowNamed,
  SilentEventSource,
  SUNDAY,
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
  // The carried over row holds an open todo dated before today, and the fixture's is due on
  // the week's Thursday, so the clock stands on the week's Sunday, when the week has passed.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${SUNDAY}T12:00:00`));
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

// A phone at 414 px, the width the model use box is checked at, beside the 390 px touch size.
const PHONE = { ...TOUCH, name: "touch-414", width: 414 };

/** The model use section, or undefined while the review has not drawn it. */
function modelUseSection(host: HTMLElement): HTMLElement | undefined {
  return [...host.querySelectorAll<HTMLElement>(".review-section")].find(
    (each) => each.querySelector(".review-heading")?.textContent === "Model use",
  );
}

/** The token chart and the cost chart, each as its box, once both are drawn. */
function chartsOf(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".review-charts > .review-section")];
}

it("#808 A7 at 414 by touch the model use section stands in one column and nothing scrolls sideways", async () => {
  answerModelUse(MODEL_USE);
  const mounted = await mountAt(PHONE, YEAR_ROUTE, {}, "no-preference");
  try {
    const { host } = mounted;
    await drawn(host, "Year in review");
    await expect.poll(() => chartsOf(host).length, PATIENCE).toBe(2);

    const [tokenChart, costChart] = chartsOf(host);
    const tokens = need(tokenChart, "the token chart").getBoundingClientRect();
    const cost = need(costChart, "the cost chart").getBoundingClientRect();
    expect(cost.top, "the cost chart sits under the token chart").toBeGreaterThanOrEqual(
      tokens.bottom,
    );

    const section = need(modelUseSection(host), "the model use section");
    const table = need(section.querySelector<HTMLElement>(".review-table"), "the model use table");
    const box = section.getBoundingClientRect();
    expect(
      table.getBoundingClientRect().right,
      "the table runs past the section",
    ).toBeLessThanOrEqual(box.right);
    expect(box.right, "the section runs past the screen").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  } finally {
    await unmount(mounted);
  }
});

it("#808 A7 at 1440x900 the token and cost charts sit side by side", async () => {
  answerModelUse(MODEL_USE);
  const mounted = await mountAt(DESKTOP, YEAR_ROUTE, {}, "no-preference");
  try {
    const { host } = mounted;
    await drawn(host, "Year in review");
    await expect.poll(() => chartsOf(host).length, PATIENCE).toBe(2);

    const [tokenChart, costChart] = chartsOf(host);
    const tokens = need(tokenChart, "the token chart").getBoundingClientRect();
    const cost = need(costChart, "the cost chart").getBoundingClientRect();
    expect(cost.left, "the cost chart starts past the token chart").toBeGreaterThanOrEqual(
      tokens.right,
    );
    expect(Math.abs(cost.top - tokens.top), "the charts share a top").toBeLessThan(1);
  } finally {
    await unmount(mounted);
  }
});

it("#808 A7 with reduced motion on the model use section animates nothing", async () => {
  answerModelUse(MODEL_USE);
  const mounted = await mountAt(DESKTOP, YEAR_ROUTE, {}, "reduce");
  try {
    const { host } = mounted;
    await drawn(host, "Year in review");
    await expect.poll(() => chartsOf(host).length, PATIENCE).toBe(2);

    const section = need(modelUseSection(host), "the model use section");
    expect(
      section.getAnimations({ subtree: true }).length,
      "animations running in the section",
    ).toBe(0);
    await nextFrame();
    expect(
      section.getAnimations({ subtree: true }).length,
      "animations running in the section",
    ).toBe(0);
  } finally {
    await unmount(mounted);
  }
});
