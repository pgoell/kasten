/**
 * Pictures of the motion work (#798) at desktop, phone and touch widths, and
 * the computed values the pictures depend on: the press give, the reduced
 * motion and contrast answers, and the type scale.
 *
 * The route is mounted the way `theme-shots.test.tsx` mounts it. Pictures land
 * in node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { startPress } from "@/lib/press";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { shot } from "./shots";
import "@/styles/app.css";

const VIM_KEY = "kasten.vim";
const REDUCED = "(prefers-reduced-motion: reduce)";
const FILES = ["Lesson.md", "Design Notes.md"];

/** Sixty lines under the paragraph, so the note is long enough to scroll. */
const LESSON = [
  "# Lesson",
  "",
  "A paragraph with **bold**, *italic*, a [[Design Notes]] link, a #tag, `inline code` and ==a highlight==.",
  "",
  "> [!note] Remember",
  "> The callout body.",
  "",
  "```ts",
  "const answer = 42;",
  "```",
  "",
  "- [ ] write the tests",
  "- [x] ship the tokens",
  "",
  ...Array.from(
    { length: 60 },
    (_, index) => `Line ${index + 1} of the lesson, with words to wrap.`,
  ),
].join("\n");

// Six notes, one of each type the graph colours and one untyped, with five links.
const GRAPH = {
  nodes: [
    {
      path: "Spaced repetition.md",
      name: "Spaced repetition",
      type: "Concept",
      tags: [],
      missing: false,
    },
    {
      path: "Ebbinghaus 1885.md",
      name: "Ebbinghaus 1885",
      type: "Source",
      tags: [],
      missing: false,
    },
    {
      path: "Hermann Ebbinghaus.md",
      name: "Hermann Ebbinghaus",
      type: "Person",
      tags: [],
      missing: false,
    },
    { path: "Make It Stick.md", name: "Make It Stick", type: "Book", tags: [], missing: false },
    { path: "SM-2.md", name: "SM-2", type: "Reference", tags: [], missing: false },
    { path: "Scratch.md", name: "Scratch", type: null, tags: [], missing: false },
  ],
  edges: [
    { source: "Spaced repetition.md", target: "Ebbinghaus 1885.md", relation: null, line: 3 },
    { source: "Ebbinghaus 1885.md", target: "Hermann Ebbinghaus.md", relation: "by", line: 4 },
    { source: "Make It Stick.md", target: "Spaced repetition.md", relation: null, line: 5 },
    { source: "SM-2.md", target: "Spaced repetition.md", relation: "implements", line: 6 },
    { source: "Scratch.md", target: "SM-2.md", relation: null, line: 7 },
  ],
  columns: [],
  rows: [],
  truncated: false,
};

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: async () => FILES,
    fetchNote: async (path: string) => {
      if (path === "Lesson.md") return LESSON;
      if (path === "Design Notes.md") return "# Design Notes\n";
      throw new real.NoteMissing(path);
    },
    saveNote: async (path: string, content: string) => ({ path, content }),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTodos: async () => [],
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
  fetchGraph: async () => GRAPH,
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

const DESKTOP = { name: "desktop-1440", width: 1440, height: 900, coarse: false };
const PHONE = { name: "phone-414", width: 414, height: 896, coarse: false };
const TOUCH = { name: "touch-390", width: 390, height: 844, coarse: true };
type Size = typeof DESKTOP;
type Theme = "light" | "dark";

const PATIENCE = { timeout: 10_000 };

interface Mounted {
  host: HTMLElement;
  root: Root;
  stop: () => void;
}

/** Whether this test changed the emulated media, so the afterEach knows to put it back. */
let emulated = false;

/** Mounts the route on Lesson.md at one size, in one theme, with vim on. */
async function mount(
  size: Size,
  theme: Theme,
  options: { reduced?: boolean; contrast?: "more" } = {},
): Promise<Mounted> {
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.coarse,
    reducedMotion: options.reduced ? "reduce" : "no-preference",
    contrast: options.contrast ?? "no-preference",
  });
  emulated = true;
  // The stub answers every query it is not given with no, so the reduced query is
  // given here too: the app reads it through this stub, not the browser's own answer.
  stubMatchMedia({
    [NARROW]: size.width < 768,
    [COARSE]: size.coarse,
    [REDUCED]: options.reduced === true,
  });
  localStorage.clear();
  localStorage.setItem(VIM_KEY, "on");
  document.documentElement.dataset.theme = theme;

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/?note=Lesson.md"] }),
  });
  await act(async () => {
    await router.load();
  });
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
  await waitFor(
    () => expect(host.querySelector(".cm-content")?.textContent).toContain("paragraph"),
    PATIENCE,
  );
  return { host, root, stop: startPress() };
}

async function unmount({ host, root, stop }: Mounted) {
  stop();
  await act(async () => root.unmount());
  host.remove();
}

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  if (emulated) {
    await commands.emulateMedia({});
    emulated = false;
  }
  await page.viewport(1280, 900);
});

/** A leader sequence pressed on the editor that has focus, as a reader presses it. */
function leader(host: HTMLElement, keys: string[]) {
  const editor = visibleEditor(host);
  editor.focus();
  for (const key of keys) {
    fireEvent.keyDown(editor, { key });
    fireEvent.keyUp(editor, { key });
  }
}

/** The editor in the pane on screen. A hidden tab's editor has no box. */
function visibleEditor(host: HTMLElement): HTMLElement {
  const editor = [...host.querySelectorAll<HTMLElement>(".cm-content")].find(
    (one) => one.offsetParent !== null,
  );
  if (!editor) throw new Error("no editor is on screen");
  return editor;
}

/** Makes a second tab, then goes back to the first, so the note is on screen and the strip has two. */
async function twoTabs(host: HTMLElement) {
  leader(host, [" ", "c", "t"]);
  await waitFor(() => expect(host.querySelectorAll("[role='tab']").length).toBe(2), PATIENCE);
  leader(host, [" ", "t", "h"]);
  await waitFor(() => expect(visibleEditor(host).textContent).toContain("paragraph"), PATIENCE);
}

/** Two animation frames: the first lays out the last change, the second paints it. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A pointer event as a mouse sends it. */
function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A CSS value as the browser resolves it, read off a probe element, so a token compares as a colour. */
function resolved(property: "backgroundColor" | "color", value: string): string {
  const probe = document.body.appendChild(document.createElement("div"));
  probe.style[property] = value;
  const colour = getComputedStyle(probe)[property];
  probe.remove();
  return colour;
}

/** The sheet's panel once it is in the DOM. */
async function sheetPanel(host: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const panel = document.querySelector<HTMLElement>("[role='dialog'][aria-label='Local graph']");
    expect(panel).not.toBeNull();
    expect(host.contains(panel)).toBe(true);
    return panel as HTMLElement;
  }, PATIENCE);
}

/** Takes the picture, and asks the width back so a run proves its size. */
async function picture(host: HTMLElement, name: string, size: Size): Promise<void> {
  await document.fonts.ready;
  expect(await shot(host, name)).toBe(size.width);
}

/** Scrolls the note on screen down a little, so the sticky strip sits over text. */
function scrollEditor(host: HTMLElement) {
  const scroller = visibleEditor(host).closest<HTMLElement>(".cm-scroller");
  if (!scroller) throw new Error("the editor has no scroller");
  scroller.scrollTop = 120;
}

// The strip of tabs, each theme, at each width.

it("tabs-desktop-1440 in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mount(DESKTOP, theme);
    try {
      await twoTabs(mounted.host);
      scrollEditor(mounted.host);
      await nextFrame();
      await nextFrame();
      await picture(mounted.host, `tabs-desktop-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("tabs-phone-414 in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mount(PHONE, theme);
    try {
      await twoTabs(mounted.host);
      scrollEditor(mounted.host);
      await nextFrame();
      await nextFrame();
      await picture(mounted.host, `tabs-phone-414-${theme}`, PHONE);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("tabs-touch-390 in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mount(TOUCH, theme);
    try {
      await twoTabs(mounted.host);
      scrollEditor(mounted.host);
      await nextFrame();
      await nextFrame();
      await picture(mounted.host, `tabs-touch-390-${theme}`, TOUCH);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("sheet-half-touch-390 in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mount(TOUCH, theme);
    try {
      leader(mounted.host, [" ", "g", "l"]);
      const panel = await sheetPanel(mounted.host);
      // Settled at the top before the finger goes down on it.
      await expect
        .poll(() => getComputedStyle(panel).transform, PATIENCE)
        .toBe("matrix(1, 0, 0, 1, 0, 0)");
      const grab = panel.querySelector<HTMLElement>("[data-sheet-drag]") as HTMLElement;
      const start = centreOf(grab);
      pointer(grab, "pointerdown", start.x, start.y);
      pointer(grab, "pointermove", start.x, start.y + panel.offsetHeight / 2);
      await nextFrame();
      await nextFrame();
      await picture(mounted.host, `sheet-half-touch-390-${theme}`, TOUCH);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("pressed-button-touch-390-light", async () => {
  const mounted = await mount(TOUCH, "light");
  try {
    const button = mounted.host.querySelector<HTMLButtonElement>("[role='toolbar'] button");
    if (!button) throw new Error("no toolbar button");
    const start = centreOf(button);
    pointer(button, "pointerdown", start.x, start.y);
    await wait(150);
    expect(getComputedStyle(button).transform).toBe("matrix(0.97, 0, 0, 0.97, 0, 0)");
    await picture(mounted.host, "pressed-button-touch-390-light", TOUCH);
    pointer(button, "pointerup", start.x, start.y);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("pressed-button-desktop-1440-dark", async () => {
  const mounted = await mount(DESKTOP, "dark");
  try {
    await twoTabs(mounted.host);
    const tab = mounted.host.querySelectorAll<HTMLButtonElement>("[role='tab']")[1];
    if (!tab) throw new Error("no second tab");
    const start = centreOf(tab);
    pointer(tab, "pointerdown", start.x, start.y);
    await wait(150);
    expect(getComputedStyle(tab).transform).toBe("matrix(0.97, 0, 0, 0.97, 0, 0)");
    await picture(mounted.host, "pressed-button-desktop-1440-dark", DESKTOP);
    pointer(tab, "pointerup", start.x, start.y);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

/** Opens the note finder with `Space f f`, and presses its second row. */
async function pressFinderRow(host: HTMLElement): Promise<HTMLElement> {
  leader(host, [" ", "f", "f"]);
  const rows = await waitFor(() => {
    const options = document.querySelectorAll<HTMLElement>("[role='option']");
    expect(options.length).toBeGreaterThan(1);
    return options;
  }, PATIENCE);
  const row = rows[1] as HTMLElement;
  const start = centreOf(row);
  pointer(row, "pointerdown", start.x, start.y);
  await wait(150);
  return row;
}

it("pressed-row-desktop-1440-light", async () => {
  const mounted = await mount(DESKTOP, "light");
  try {
    const row = await pressFinderRow(mounted.host);
    expect(getComputedStyle(row).transform).toBe("none");
    expect(getComputedStyle(row).backgroundColor).toBe(
      resolved("backgroundColor", "var(--k-surface)"),
    );
    await picture(mounted.host, "pressed-row-desktop-1440-light", DESKTOP);
    const start = centreOf(row);
    pointer(row, "pointerup", start.x, start.y);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("pressed-row-touch-390-dark", async () => {
  const mounted = await mount(TOUCH, "dark");
  try {
    const row = await pressFinderRow(mounted.host);
    expect(getComputedStyle(row).transform).toBe("none");
    expect(getComputedStyle(row).backgroundColor).toBe(
      resolved("backgroundColor", "var(--k-surface)"),
    );
    await picture(mounted.host, "pressed-row-touch-390-dark", TOUCH);
    const start = centreOf(row);
    pointer(row, "pointerup", start.x, start.y);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("reduced-motion-touch-390-light", async () => {
  const mounted = await mount(TOUCH, "light", { reduced: true });
  try {
    // The answer the sheet reads, checked before it is asked for.
    expect(matchMedia(REDUCED).matches).toBe(true);
    leader(mounted.host, [" ", "g", "l"]);
    const panel = await sheetPanel(mounted.host);
    // The fade in ends at full opacity, and no slide is ever made.
    await expect.poll(() => Number(getComputedStyle(panel).opacity), PATIENCE).toBe(1);
    expect(getComputedStyle(panel).transform).toBe("matrix(1, 0, 0, 1, 0, 0)");
    await picture(mounted.host, "reduced-motion-touch-390-light", TOUCH);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("contrast-more-desktop-1440-light", async () => {
  const mounted = await mount(DESKTOP, "light", { contrast: "more" });
  try {
    await twoTabs(mounted.host);
    const strip = mounted.host.querySelector<HTMLElement>("[role='tablist']") as HTMLElement;
    const style = getComputedStyle(strip);
    expect(style.backdropFilter).toBe("none");
    // `rgb(` rather than `rgba(`: the background is solid, with no alpha at all.
    expect(style.backgroundColor).toMatch(/^rgb\(/);
    expect(style.borderBottomColor).toBe(resolved("color", "var(--k-ink)"));
    await picture(mounted.host, "contrast-more-desktop-1440-light", DESKTOP);
  } finally {
    await unmount(mounted);
  }
}, 60_000);

// The type scale, on rendered text. Each span is a probe, measured in px.

/**
 * The computed type of a probe span with the given classes. Copied out before
 * the span goes, since a live style declaration reads empty once its element is gone.
 */
function probe(classes: string, text: string) {
  const span = document.body.appendChild(document.createElement("span"));
  span.className = classes;
  span.textContent = text;
  const style = getComputedStyle(span);
  const values = {
    fontSize: style.fontSize,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
  };
  span.remove();
  return values;
}

it("text-k-64 tracks -0.018em and leads at 1.04", () => {
  const style = probe("text-k-64", "Ag");
  expect(parseFloat(style.letterSpacing)).toBeCloseTo(-1.152, 3);
  expect(parseFloat(style.lineHeight)).toBeCloseTo(66.56, 2);
  expect(parseFloat(style.fontSize)).toBeCloseTo(64, 3);
});

it("text-k-13 tracks 0.006em", () => {
  const style = probe("text-k-13", "Ag");
  expect(parseFloat(style.letterSpacing)).toBeCloseTo(0.078, 3);
  expect(parseFloat(style.fontSize)).toBeCloseTo(13, 3);
});

it("tracking-k-kbd on 13 px text is 0.02em", () => {
  const style = probe("text-k-13 tracking-k-kbd", "Ag");
  expect(parseFloat(style.letterSpacing)).toBeCloseTo(0.26, 3);
  expect(parseFloat(style.fontSize)).toBeCloseTo(13, 3);
});
