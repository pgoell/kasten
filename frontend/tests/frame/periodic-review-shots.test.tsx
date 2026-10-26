/**
 * Pictures of the periodic reviews (#807) to look at by eye: the year review on the yearly note
 * and the week review on the weekly one, a phone at 390 by 844 by touch and a desktop at 1440 by
 * 900 with a mouse, in both themes, with GitHub on and off, the other palettes and reduced motion.
 * Each picture is its own test, run alone with `-t "shot <name>"`, and lands in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1. Without it the tests are skipped.
 */

import {
  drawnTitle,
  installShotReads,
  mountLook,
  restoreShot,
  SilentEventSource,
  scrollToOwnText,
  stubShotFetch,
  WEEK_ROUTE,
  YEAR_ROUTE,
} from "./periodic-review-shots-fixture";
import { DESKTOP, TOUCH, unmount } from "./reader-fixture";
import { shot } from "./shots";

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

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
  stubShotFetch();
  installShotReads(mocks);
});

afterEach(restoreShot);

/** A picture test: skipped unless the shots are asked for, as overview-shots does. */
const picture = import.meta.env.VITE_KASTEN_SHOTS ? it : it.skip;

picture("shot phone-year-top", async () => {
  const mounted = await mountLook(TOUCH, YEAR_ROUTE);
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "phone-year-top")).toBe(390);
  } finally {
    await unmount(mounted);
  }
});

picture("shot phone-year-below", async () => {
  const mounted = await mountLook(TOUCH, YEAR_ROUTE);
  try {
    await drawnTitle(mounted.host, "Year in review");
    await scrollToOwnText(mounted.host);
    expect(await shot(mounted.host, "phone-year-below")).toBe(390);
  } finally {
    await unmount(mounted);
  }
});

picture("shot phone-week-top", async () => {
  const mounted = await mountLook(TOUCH, WEEK_ROUTE);
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "phone-week-top")).toBe(390);
  } finally {
    await unmount(mounted);
  }
});

picture("shot phone-week-below", async () => {
  const mounted = await mountLook(TOUCH, WEEK_ROUTE);
  try {
    await drawnTitle(mounted.host, "Week in review");
    await scrollToOwnText(mounted.host);
    expect(await shot(mounted.host, "phone-week-below")).toBe(390);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-light", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE);
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-light")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-dark", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE, { theme: "dark" });
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-dark")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-github-off", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE, { github: false });
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-github-off")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-light", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE);
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-light")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-dark", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE, { theme: "dark" });
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-dark")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-github-off", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE, { github: false });
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-github-off")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-russet", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE, { palette: "russet" });
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-russet")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-peach", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE, { palette: "peach" });
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-peach")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-year-pansy", async () => {
  const mounted = await mountLook(DESKTOP, YEAR_ROUTE, { palette: "pansy", theme: "dark" });
  try {
    await drawnTitle(mounted.host, "Year in review");
    expect(await shot(mounted.host, "desktop-year-pansy")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});

picture("shot desktop-week-reduced-motion", async () => {
  const mounted = await mountLook(DESKTOP, WEEK_ROUTE, { motion: "reduce" });
  try {
    await drawnTitle(mounted.host, "Week in review");
    expect(await shot(mounted.host, "desktop-week-reduced-motion")).toBe(1440);
  } finally {
    await unmount(mounted);
  }
});
