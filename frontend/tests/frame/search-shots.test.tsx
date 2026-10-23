/**
 * Pictures of the search page (#783), to look at by eye: at 1440 by 900 in light and
 * dark, narrowed to one week and with the busiest bar under the pointer; at 390 by 844
 * with touch, one column, Filters opened in the light picture only; and in the three
 * accent palettes the app has besides the default.
 *
 * The answer is a fixed vault of about 120 lines in 25 notes over the last fourteen
 * weeks. Weeks 33 and 36 are empty, week 38 is the busy one, and week 43 (the current
 * week) has three lines. Skipped unless VITE_KASTEN_SHOTS=1; pictures land in
 * node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, waitFor } from "@testing-library/react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { NoteSearch } from "@/components/note-search";
import type { SearchHit } from "@/lib/api";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { shot } from "./shots";
import "@/styles/app.css";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const NOW = new Date(2026, 9, 23);
const PATIENCE = { timeout: 10_000 };

const DESKTOP = { width: 1440, height: 900, coarse: false };
const TOUCH = { width: 390, height: 844, coarse: true };
type Size = typeof DESKTOP;

/** Lines written in each week, from week 30 to week 43; the weeks left out are empty. */
const COUNTS: Record<number, number> = {
  30: 8,
  31: 9,
  32: 7,
  34: 8,
  35: 7,
  37: 9,
  38: 40,
  39: 8,
  40: 6,
  41: 8,
  42: 7,
  43: 3,
};

const FOLDERS = ["projects", "reference", "reading", "journal"];
const NOTES = Array.from(
  { length: 25 },
  (_, at) => `${FOLDERS[at % FOLDERS.length]}/note-${String(at + 1).padStart(2, "0")}.md`,
);
const TOPICS = [
  "the index",
  "replication",
  "vacuum",
  "backups",
  "connection pooling",
  "migrations",
  "the query planner",
  "partitions",
];
const TAGS = [["#db"], ["#reading"], [], ["#ops"]];

/** The Monday of `week` plus `offset` days, as the `YYYY-MM-DD` a hit carries. */
function dayOf(week: number, offset: number): string {
  return new Date(Date.UTC(2026, 6, 20 + (week - 30) * 7 + offset)).toISOString().slice(0, 10);
}

const LINES: SearchHit[] = [];
let made = 0;
for (const [week, count] of Object.entries(COUNTS)) {
  for (let k = 0; k < count; k++) {
    const at = made++;
    // Seven is prime to the twenty-five notes, so the lines spread over every note.
    const path = NOTES[(at * 7) % NOTES.length] as string;
    const topic = TOPICS[at % TOPICS.length];
    // Every fifth line says the term twice, so the accent has two runs to paint.
    const text =
      at % 5 === 0 ? `postgres and postgres for ${topic}` : `postgres takes ${topic} in stride`;
    LINES.push({
      path,
      line: at + 2,
      text,
      date: dayOf(Number(week), at % 5),
      tags: TAGS[at % TAGS.length] as string[],
    });
  }
}

/** Two lines in the archive, which only the archive-in answer carries. */
const ARCHIVED: SearchHit[] = [
  {
    path: "98 Archive/old-plan.md",
    line: 3,
    text: "postgres in the old plan",
    date: dayOf(40, 2),
    tags: ["#db"],
  },
  {
    path: "98 Archive/old-plan.md",
    line: 9,
    text: "postgres replicas in the archive",
    date: dayOf(41, 1),
    tags: [],
  },
];

const { searchNotes, fetchMentions, fetchTodos, fetchNote } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchMentions: vi.fn(),
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  searchNotes,
  fetchMentions,
  fetchTodos,
  fetchNote,
}));

/** The answer to a query: every line holding it, the archive's two only when asked. */
function answer(query: string, archive?: boolean): SearchHit[] {
  const found = archive ? [...LINES, ...ARCHIVED] : LINES;
  return found.filter((hit) => hit.text.toLowerCase().includes(query.toLowerCase()));
}

/** The page under test: the search over `NOW`, holding the week the way the route does. */
function Page({ client }: { client: QueryClient }) {
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

/** One bar of the histogram, by its week number. */
function bar(host: HTMLElement, week: number): HTMLElement {
  const found = host.querySelector<HTMLElement>(`button[aria-label^="Week ${week},"]`);
  if (!found) throw new Error(`no bar for week ${week}`);
  return found;
}

interface Options {
  palette?: string;
  /** Narrow the results to this week by a click on its bar. */
  week?: number;
  /** Put the pointer on the busiest bar, so its count shows. */
  hover?: boolean;
  /** Open the filter column folded into the Filters button, on a phone. */
  filters?: boolean;
}

/** One picture of the search page at one size and theme, once its answer is in and its rows have arrived. */
async function shootSearch(
  name: string,
  size: Size,
  theme: Theme,
  options: Options = {},
): Promise<void> {
  searchNotes.mockImplementation(async (query: string, archive?: boolean) =>
    answer(query, archive),
  );
  fetchMentions.mockResolvedValue([]);
  fetchTodos.mockResolvedValue([]);

  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.coarse,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  // The stub answers each query the app asks: the layout reads the width and the pointer here.
  stubMatchMedia({ [NARROW]: size.width < 768, [COARSE]: size.coarse });
  localStorage.clear();
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, options.palette ?? "poel");
  applyTheme();

  const host = document.body.appendChild(document.createElement("div"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<Page client={client} />);
    });
    const input = host.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "postgres" } });
    // The answer has landed once the first row is drawn, which is past the settle delay.
    await waitFor(
      () => expect(host.querySelectorAll('[role="option"]').length).toBeGreaterThan(0),
      PATIENCE,
    );

    if (options.week !== undefined) {
      fireEvent.click(bar(host, options.week));
      await waitFor(
        () => expect(bar(host, options.week as number).getAttribute("aria-pressed")).toBe("true"),
        PATIENCE,
      );
    }
    if (options.filters) {
      fireEvent.click(host.querySelector('button[aria-expanded="false"]') as HTMLElement);
    }
    if (options.hover) fireEvent.mouseEnter(bar(host, 38));

    // The lines arrive on a stagger, so the picture waits until every entrance has
    // finished and shows the end state, not a row mid-slide.
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
    await document.fonts.ready;

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
    expect(await shot(dialog, name)).toBe(size.width);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** A picture test that runs only when pictures are asked for. */
function shotTest(name: string, run: () => Promise<void>) {
  it.skipIf(!SHOTS)(name, run, 300_000);
}

shotTest("search-desktop-1440-light", () =>
  shootSearch("search-desktop-1440-light", DESKTOP, "light", { hover: true }),
);
shotTest("search-desktop-1440-dark", () =>
  shootSearch("search-desktop-1440-dark", DESKTOP, "dark", { hover: true }),
);
shotTest("search-week-desktop-1440-light", () =>
  shootSearch("search-week-desktop-1440-light", DESKTOP, "light", { week: 38 }),
);
shotTest("search-week-desktop-1440-dark", () =>
  shootSearch("search-week-desktop-1440-dark", DESKTOP, "dark", { week: 38 }),
);
shotTest("search-touch-390-light", () =>
  shootSearch("search-touch-390-light", TOUCH, "light", { filters: true }),
);
shotTest("search-touch-390-dark", () => shootSearch("search-touch-390-dark", TOUCH, "dark"));
for (const palette of ["russet", "peach", "pansy"]) {
  for (const theme of ["light", "dark"] as const) {
    const name = `search-palette-${palette}-1440-${theme}`;
    shotTest(name, () => shootSearch(name, DESKTOP, theme, { palette }));
  }
}
