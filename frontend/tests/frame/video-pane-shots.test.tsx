/**
 * Pictures of the video pane (#791), to look at by eye. Skipped unless
 * VITE_KASTEN_SHOTS=1; the pictures land in node_modules/.cache/kasten-shots.
 *
 * Each picture is its own test, so `-t` can name one by its end (`name$`).
 */

import "./html-take-api";
import { commands as browser, page, userEvent } from "vitest/browser";
import { applyTheme, PALETTE_KEY, THEME_KEY } from "@/lib/theme";
import { type Mounted, setUp, tearDown } from "./html-take-fixture";
import { DESKTOP, leader, mount, registerReaderFixture, unmount } from "./reader-fixture";
import { shot } from "./shots";
import {
  deliver,
  manyChapters,
  paneButton,
  paneOf,
  registerNotes,
  renderPanes,
  SECONDS,
  shieldOf,
  TAKE,
  TALK,
  talkNote,
  titled,
  VIDEO,
} from "./video-pane-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
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

/** The same talk with twenty chapters, for the picture of the transcript's height. */
const MANY = "Talks/Many chapters.md";

registerReaderFixture();
// The talk the pictures show has one take already, under `## Highlights`.
registerNotes({
  [TALK]: talkNote(VIDEO, TAKE),
  [MANY]: talkNote(VIDEO, TAKE, manyChapters()),
});

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const DESK = { width: 1440, height: 900, touch: false };
const PHONE = { width: 414, height: 896, touch: true };
type Size = typeof DESK;

function shotTest(name: string, run: () => Promise<void>) {
  it.skipIf(!SHOTS)(name, run, 300_000);
}

/** The picture of `element`, which must come out the width it is on the page. */
async function picture(element: Element, name: string) {
  expect(await shot(element, name)).toBe(Math.round(element.getBoundingClientRect().width));
}

/** The viewport, the emulated touch, and the theme and palette the picture is taken in. */
async function look(size: Size, theme: "light" | "dark", palette = "poel") {
  await page.viewport(size.width, size.height);
  await browser.emulateMedia({
    touch: size.touch,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, palette);
  applyTheme();
}

/**
 * Brings the transcript up on a phone, where it sits under the player and the
 * pane scrolls to it. The picture and the selection are of what is on screen.
 */
function showTranscript(host: HTMLElement) {
  host.querySelector("[aria-label='Transcript']")?.scrollIntoView({ block: "start" });
}

/** Selects the third paragraph's words, the way a reader's drag over them does. */
function selectThird(host: HTMLElement) {
  const paragraph = host.querySelectorAll("[aria-label='Transcript'] li p")[2];
  const words = paragraph?.lastChild;
  if (!(words instanceof Text)) throw new Error("no third paragraph");
  const range = document.createRange();
  range.setStart(words, 0);
  range.setEnd(words, words.length);
  const selection = window.getSelection() as Selection;
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("the video pane pictures, alone", () => {
  let mounted: Mounted;

  beforeEach(async () => {
    mounted = await setUp();
  });

  afterEach(async () => {
    await tearDown(mounted);
  });

  /** The pane with its player, opened on the video view and with the transcript following the player. */
  async function viewOpen(size: Size, theme: "light" | "dark", palette = "poel", note = TALK) {
    await look(size, theme, palette);
    renderPanes(mounted, [{ note, onTake: async () => "hl-7f3a2c" }]);
    const pane = paneOf(mounted.host);
    await expect.poll(() => paneButton(pane, "Video view")).toBeDefined();
    await userEvent.click(paneButton(pane, "Video view") as HTMLButtonElement);
    await expect.poll(() => pane.querySelector("[aria-label='Transcript']")).not.toBeNull();
    titled();
    deliver({ currentTime: SECONDS[4] });
    await expect.poll(() => pane.querySelector("[aria-current]")).not.toBeNull();
    return pane;
  }

  shotTest("video-view-1440-light", async () => {
    const pane = await viewOpen(DESK, "light");
    await document.fonts.ready;
    await picture(pane, "video-view-1440-light");
  });

  shotTest("video-view-1440-dark", async () => {
    const pane = await viewOpen(DESK, "dark");
    await document.fonts.ready;
    await picture(pane, "video-view-1440-dark");
  });

  shotTest("video-view-1440-light-russet", async () => {
    const pane = await viewOpen(DESK, "light", "russet");
    await document.fonts.ready;
    await picture(pane, "video-view-1440-light-russet");
  });

  shotTest("video-view-1440-light-peach", async () => {
    const pane = await viewOpen(DESK, "light", "peach");
    await document.fonts.ready;
    await picture(pane, "video-view-1440-light-peach");
  });

  shotTest("video-view-1440-light-pansy", async () => {
    const pane = await viewOpen(DESK, "light", "pansy");
    await document.fonts.ready;
    await picture(pane, "video-view-1440-light-pansy");
  });

  shotTest("video-view-414-light", async () => {
    const pane = await viewOpen(PHONE, "light");
    showTranscript(mounted.host);
    selectThird(mounted.host);
    await expect.poll(() => pane.querySelector("[data-take]")).not.toBeNull();
    await document.fonts.ready;
    await picture(pane, "video-view-414-light");
  });

  shotTest("video-view-414-dark-many", async () => {
    const pane = await viewOpen(PHONE, "dark", "poel", MANY);
    showTranscript(mounted.host);
    selectThird(mounted.host);
    await expect.poll(() => pane.querySelector("[data-take]")).not.toBeNull();
    await document.fonts.ready;
    await picture(pane, "video-view-414-dark-many");
  });

  shotTest("video-view-414-dark", async () => {
    const pane = await viewOpen(PHONE, "dark");
    showTranscript(mounted.host);
    selectThird(mounted.host);
    await expect.poll(() => pane.querySelector("[data-take]")).not.toBeNull();
    await document.fonts.ready;
    await picture(pane, "video-view-414-dark");
  });

  shotTest("video-shield-hover-1440-light", async () => {
    await look(DESK, "light");
    renderPanes(mounted, [{ note: TALK }]);
    const pane = paneOf(mounted.host);
    await expect.poll(() => pane.querySelector("[data-video-shield]")).not.toBeNull();
    titled();
    const shield = shieldOf(mounted.host);
    await userEvent.hover(shield);
    await expect.poll(() => shield.matches(":hover")).toBe(true);
    // Headless Chrome answers no to `(hover: hover)` and refuses to be told it is a
    // hover pointer, so Tailwind's `group-hover` never applies to it. The rule is
    // forced for this picture only; the delay on the real hover is not measured here.
    const force = document.createElement("style");
    force.textContent =
      "[data-video-shield] .group-hover\\:opacity-100 { opacity: 1 !important; transition: none !important; }";
    document.head.append(force);
    try {
      const hint = [...shield.querySelectorAll<HTMLElement>("span")].find((span) =>
        (span.textContent ?? "").startsWith("Click to play"),
      );
      if (!hint) throw new Error("no hint in the shield");
      await expect.poll(() => getComputedStyle(hint).opacity).toBe("1");
      await document.fonts.ready;
      await picture(pane, "video-shield-hover-1440-light");
    } finally {
      force.remove();
    }
  });

  shotTest("video-take-1440-light", async () => {
    const pane = await viewOpen(DESK, "light");
    selectThird(mounted.host);
    await expect.poll(() => pane.querySelector("[data-take]")).not.toBeNull();
    await userEvent.keyboard("y");
    await expect.poll(() => pane.querySelector("[role='status']")).not.toBeNull();
    await document.fonts.ready;
    await picture(pane, "video-take-1440-light");
  });

  shotTest("video-take-1440-dark", async () => {
    const pane = await viewOpen(DESK, "dark");
    selectThird(mounted.host);
    await expect.poll(() => pane.querySelector("[data-take]")).not.toBeNull();
    await userEvent.keyboard("y");
    await expect.poll(() => pane.querySelector("[role='status']")).not.toBeNull();
    await document.fonts.ready;
    await picture(pane, "video-take-1440-dark");
  });
});

describe("the video pane pictures, beside its note", () => {
  let route: Awaited<ReturnType<typeof mount>>;

  afterEach(async () => {
    await unmount(route);
  });

  /** The note at 1440, with the video pane opened beside it by `Space g v`, paused. */
  async function beside(theme: "light" | "dark") {
    route = await mount(DESKTOP, theme, `/?note=${encodeURIComponent(TALK)}`, "[data-reader-grid]");
    await expect.poll(() => route.host.querySelector(".cm-time")).not.toBeNull();
    leader(route.host, [" ", "g", "v"]);
    await expect.poll(() => route.host.querySelector("[data-video-pane] iframe")).not.toBeNull();
    titled();
    await document.fonts.ready;
  }

  shotTest("video-pane-1440-light", async () => {
    await beside("light");
    await picture(route.host, "video-pane-1440-light");
  });

  shotTest("video-pane-1440-dark", async () => {
    await beside("dark");
    await picture(route.host, "video-pane-1440-dark");
  });
});
