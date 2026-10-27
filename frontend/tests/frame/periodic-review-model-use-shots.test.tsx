/**
 * Pictures of the year review's Model use section (#808) to look at by eye, from the made-up
 * sample sessions: the collector's lines are in model-use-sample.json. Each picture is its own test,
 * run alone with `-t "shot <name>$"` and VITE_KASTEN_SHOTS=1, and lands in node_modules/.cache/kasten-shots.
 */

import {
  drawnTitle,
  installShotReads,
  type Look,
  mountLook,
  restoreShot,
  SilentEventSource,
  stubShotFetch,
  YEAR_ROUTE,
} from "./periodic-review-shots-fixture";
import { DESKTOP, need, nextFrame, type Size, TOUCH, unmount } from "./reader-fixture";
import { shot } from "./shots";

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

vi.mock("@/lib/log/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log/food-api")>()),
  fetchLog: mocks.fetchLog,
}));

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

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
  stubShotFetch();
  installShotReads(mocks);
});

afterEach(restoreShot);

/** A picture test: skipped unless the shots are asked for, as periodic-review-shots does. */
const picture = import.meta.env.VITE_KASTEN_SHOTS ? it : it.skip;

const PHONE: Size = { ...TOUCH, name: "touch-414", width: 414 };

/** Scrolls the review's model-use charts to the top of the view, the way a reader scrolls to them. */
async function scrollToModelUse(host: HTMLElement): Promise<void> {
  const section = [...host.querySelectorAll<HTMLElement>(".review-section")].find(
    (each) => each.querySelector(".review-heading")?.textContent === "Tokens per month",
  );
  need(section, "the tokens per month chart").scrollIntoView({ block: "start" });
  await nextFrame();
  await nextFrame();
}

/** The year review with its Model use section in view, as the model-use pictures show it. */
async function modelUseShot(name: string, size: Size, look: Look = {}): Promise<void> {
  const mounted = await mountLook(size, YEAR_ROUTE, look);
  try {
    await drawnTitle(mounted.host, "Year in review");
    await scrollToModelUse(mounted.host);
    expect(await shot(mounted.host, name)).toBe(size.width);
  } finally {
    await unmount(mounted);
  }
}

picture("shot phone-year-model-use", () => modelUseShot("phone-year-model-use", PHONE));

picture("shot phone-year-model-use-dark", () =>
  modelUseShot("phone-year-model-use-dark", PHONE, { theme: "dark" }),
);

picture("shot desktop-year-model-use-light", () =>
  modelUseShot("desktop-year-model-use-light", DESKTOP),
);

picture("shot desktop-year-model-use-dark", () =>
  modelUseShot("desktop-year-model-use-dark", DESKTOP, { theme: "dark" }),
);

picture("shot desktop-year-model-use-reduced-motion", () =>
  modelUseShot("desktop-year-model-use-reduced-motion", DESKTOP, { motion: "reduce" }),
);

picture("shot desktop-year-model-use-russet", () =>
  modelUseShot("desktop-year-model-use-russet", DESKTOP, { palette: "russet" }),
);

picture("shot desktop-year-model-use-peach", () =>
  modelUseShot("desktop-year-model-use-peach", DESKTOP, { palette: "peach" }),
);

picture("shot desktop-year-model-use-pansy-dark", () =>
  modelUseShot("desktop-year-model-use-pansy-dark", DESKTOP, { palette: "pansy", theme: "dark" }),
);

picture("shot desktop-year-model-use-empty", () =>
  modelUseShot("desktop-year-model-use-empty", DESKTOP, { modelUse: false }),
);
