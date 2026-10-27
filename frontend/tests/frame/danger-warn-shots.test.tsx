/**
 * Pictures of the danger and warn colours (#1105, #1106) in the three palettes that
 * changed, russet, peach and pansy, in light and dark, at desktop and touch phone
 * width. Each picture answers what it paints: the overdue date, the wikilink, the
 * warn token, the tag slot `--tg-8` and the warning callout's title.
 *
 * The hub holds an overdue todo, a wikilink and a warning callout. Its four links
 * are drawn in the local graph's margin, where `--tg-8` shows. The editor itself
 * paints tags in the accent. The margin is radial, so a node takes its first tag's
 * slot and ignores its type, which is why the links carry a tag in the `--tg-8`
 * slot. Mounted through the reader fixture's `mount`. Pictures land in
 * node_modules/.cache/kasten-shots with VITE_KASTEN_SHOTS=1.
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { waitFor } from "@testing-library/react";
import { commands, page } from "vitest/browser";
import { tagVariable } from "@/lib/graph/graph";
import {
  closeTree,
  DESKTOP,
  type Mounted,
  mount,
  need,
  nextFrame,
  PATIENCE,
  resolved,
  type Theme,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";
import { shot } from "./shots";

const HUB = "Hub.md";
const PALETTE_KEY = "kasten.palette";
const THEMES: Theme[] = ["light", "dark"];

/** The notes the hub links to. */
const LINKED = ["Alpha", "Beta", "Gamma", "Delta"];

/**
 * The first `source<n>` tag whose hash lands in the `--tg-8` slot (graph.ts). Found
 * here rather than written out, so the pick follows the hash the app really uses, and
 * about one tag in ten lands there.
 */
const SOURCE_TAG = need(
  Array.from({ length: 100 }, (_, n) => `source${n}`).find((tag) => tagVariable(tag) === "--tg-8"),
  "a tag in the --tg-8 slot",
);

/**
 * The overdue date is the form `DUE` in todo-fields.ts reads, and 2020 has passed.
 * The callout's title is the one the editor paints in `--callout-warning`.
 */
const HUB_TEXT = [
  "# Hub",
  "",
  `A paragraph of the hub, which links to ${LINKED.map((name) => `[[${name}]]`).join(", ")}, with words enough to wrap across the reading measure.`,
  "",
  "- [ ] overdue 📅 2020-01-02",
  "",
  "> [!warning] Warning",
  "> A warning callout with a line under it.",
  "",
].join("\n");

const NOTES: Record<string, string> = {
  [HUB]: HUB_TEXT,
  ...Object.fromEntries(LINKED.map((name) => [`${name}.md`, `# ${name}\n`])),
};

// The graph the margin draws: the hub and its four links, each link a `Source` with the tag.
const GRAPH = {
  nodes: [
    { path: HUB, name: "Hub", type: null, tags: [], missing: false },
    ...LINKED.map((name) => ({
      path: `${name}.md`,
      name,
      type: "Source",
      tags: [SOURCE_TAG],
      missing: false,
    })),
  ],
  edges: LINKED.map((name) => ({ source: HUB, target: `${name}.md`, relation: null, line: 3 })),
  columns: [],
  rows: [],
  truncated: false,
};

/** What a picture paints: the overdue date, the wikilink, the warn token, the tag slot and the callout title. */
type Paint = { overdue: string; link: string; warn: string; tg8: string; callout: string };
type Answer = Paint & { width: number };

/**
 * The colours each palette paints, as `getComputedStyle` answers them. The rgb form is
 * what the browser gives back for a colour, so the expectations are written the same way.
 * The wikilink reads `--k-link`, which equals the accent in every palette.
 */
const EXPECTED: Record<string, Record<Theme, Paint>> = {
  russet: {
    light: {
      overdue: "rgb(125, 40, 60)",
      link: "rgb(154, 81, 67)",
      warn: "rgb(128, 107, 0)",
      tg8: "rgb(151, 102, 64)",
      callout: "rgb(128, 107, 0)",
    },
    dark: {
      overdue: "rgb(255, 182, 192)",
      link: "rgb(229, 156, 141)",
      warn: "rgb(195, 176, 100)",
      tg8: "rgb(213, 160, 120)",
      callout: "rgb(195, 176, 100)",
    },
  },
  peach: {
    light: {
      overdue: "rgb(109, 54, 60)",
      link: "rgb(185, 49, 0)",
      warn: "rgb(118, 109, 72)",
      tg8: "rgb(0, 128, 109)",
      callout: "rgb(118, 109, 72)",
    },
    dark: {
      overdue: "rgb(251, 184, 188)",
      link: "rgb(253, 142, 112)",
      warn: "rgb(185, 177, 136)",
      tg8: "rgb(88, 188, 167)",
      callout: "rgb(185, 177, 136)",
    },
  },
  pansy: {
    light: {
      overdue: "rgb(126, 43, 21)",
      link: "rgb(168, 63, 93)",
      warn: "rgb(149, 98, 18)",
      tg8: "rgb(136, 110, 0)",
      callout: "rgb(149, 98, 18)",
    },
    dark: {
      overdue: "rgb(255, 185, 165)",
      link: "rgb(244, 141, 165)",
      warn: "rgb(217, 167, 105)",
      tg8: "rgb(193, 170, 94)",
      callout: "rgb(217, 167, 105)",
    },
  },
};

/**
 * The four answers of one palette, in the order they are taken: light at desktop
 * then phone width, then dark at the same two widths.
 */
function expected(palette: string): Answer[] {
  const [desktop, phone] = [DESKTOP.width, TOUCH.width];
  const { light, dark } = need(EXPECTED[palette], `expectations for ${palette}`);
  return [
    { width: desktop, ...light },
    { width: phone, ...light },
    { width: desktop, ...dark },
    { width: phone, ...dark },
  ];
}

/** The painted text colour as the browser resolves it, in the rgb form the expectations use. */
const colour = (element: Element) => getComputedStyle(element).color;

/** The colours the hub paints now, read off the marks the editor draws. */
function paint(host: HTMLElement): Paint {
  return {
    overdue: colour(need(host.querySelector(".cm-todo-overdue"), "overdue date")),
    link: colour(need(host.querySelector(".cm-wikilink"), "wikilink")),
    warn: resolved("color", "var(--k-warn)"),
    tg8: resolved("color", "var(--tg-8)"),
    callout: colour(
      need(host.querySelector(".cm-callout-warning .cm-callout-title"), "warning callout title"),
    ),
  };
}

/** The hub mounted at one size and theme in one palette, with its text in the editor. */
async function mountHub(
  size: typeof DESKTOP | typeof TOUCH,
  theme: Theme,
  palette: string,
): Promise<Mounted> {
  // The palette is stored the way the app stores a pick, and set on the root the way
  // the palette blocks of kasten-theme.css read it.
  document.documentElement.dataset.palette = palette;
  const mounted = await mount(
    size,
    theme,
    `/?note=${encodeURIComponent(HUB)}`,
    "[data-reader-grid]",
    { [PALETTE_KEY]: palette },
  );
  await waitFor(
    () => expect(visibleEditor(mounted.host).textContent).toContain("paragraph"),
    PATIENCE,
  );
  return mounted;
}

/** The sheet over the window or the note, when one is on screen. */
const sheet = () =>
  document.querySelector<HTMLElement>("[role='dialog'][aria-label='Local graph']");

/** Waits for the margin's canvas to exist and two frames to paint it. */
async function drawn(host: HTMLElement) {
  await waitFor(
    () => expect(host.querySelector("[data-margin='links'] canvas")).not.toBeNull(),
    PATIENCE,
  );
  await nextFrame();
  await nextFrame();
}

/**
 * Waits for the callout the answers read and for the which-key overlay to close. The
 * leader keys that fold the file tree can leave the overlay on screen for a moment, and
 * a picture taken then shows it over the note.
 */
async function settled(host: HTMLElement) {
  await waitFor(
    () => expect(host.querySelector(".cm-callout-warning .cm-callout-title")).not.toBeNull(),
    PATIENCE,
  );
  await waitFor(
    () => expect(document.querySelector("[role='dialog'][aria-label='Leader keys']")).toBeNull(),
    PATIENCE,
  );
}

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

// The api mocks read NOTES and GRAPH lazily, inside their functions, because vi.mock is
// hoisted above the constants.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: async () => Object.keys(NOTES),
    fetchNote: async (path: string) => {
      const text = NOTES[path];
      if (text === undefined) throw new real.NoteMissing(path);
      return text;
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
    fetchMentions: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: async () => GRAPH,
}));

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-palette");
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
});

for (const palette of Object.keys(EXPECTED)) {
  it(`shot danger-warn-${palette}`, async () => {
    // One answer per theme and size, read off the note. On a phone that is with the sheet
    // closed, where the note is on screen; the graph picture paints the same note.
    const taken: Answer[] = [];
    for (const theme of THEMES) {
      const desktop = await mountHub(DESKTOP, theme, palette);
      try {
        // The margin sits beside the note only once the file tree is folded.
        await closeTree(desktop.host);
        await drawn(desktop.host);
        await settled(desktop.host);
        const width = await shot(desktop.host, `danger-warn-${palette}-${theme}-desktop`);
        taken.push({ width, ...paint(desktop.host) });
      } finally {
        await unmount(desktop);
      }

      const phone = await mountHub(TOUCH, theme, palette);
      try {
        const { host } = phone;
        await settled(host);
        const width = await shot(host, `danger-warn-${palette}-${theme}-phone-note`);
        taken.push({ width, ...paint(host) });

        // On a phone the graph opens as a bottom sheet over the note.
        visibleEditor(host).focus();
        need(host.querySelector<HTMLElement>("[data-head='graph']"), "graph button").click();
        await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
        const panel = need(sheet(), "bottom sheet");
        // At rest the bottom sheet's foot is the screen's foot.
        await expect
          .poll(() => Math.round(panel.getBoundingClientRect().bottom), PATIENCE)
          .toBe(844);
        await waitFor(() => expect(panel.querySelector("canvas")).not.toBeNull(), PATIENCE);
        await nextFrame();
        await nextFrame();
        await shot(host, `danger-warn-${palette}-${theme}-phone-graph`);
      } finally {
        await unmount(phone);
      }
    }
    expect(taken).toEqual(expected(palette));
  }, 120_000);
}
