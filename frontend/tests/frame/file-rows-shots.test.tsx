/**
 * Pictures of the finder's and the search's rows for pdf, epub and html files
 * (#1199), to look at by eye: at 1440 by 900 and at 414 by 896 with touch, light
 * and dark. Skipped unless VITE_KASTEN_SHOTS=1; pictures land in
 * node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, waitFor } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { NoteFinder } from "@/components/note-finder";
import { NoteSearch } from "@/components/note-search";
import type { SearchHit } from "@/lib/api";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { shot } from "./shots";
import "@/styles/app.css";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const PATIENCE = { timeout: 10_000 };

const DESKTOP = { width: 1440, height: 900, coarse: false };
const PHONE = { width: 414, height: 896, coarse: true };
type Size = typeof DESKTOP;

const NOTES = ["projects/Hauskauf.md", "reading/Expecting Better.md", "projects/kasten.md"];
const FILES = [
  "projects/Hauskauf/Exposé Mehrfamilienhaus.pdf",
  "reading/Expecting Better.epub",
  "projects/Hauskauf/Finanzierungsrechner.html",
];

const HITS: SearchHit[] = (
  [
    {
      path: "projects/Hauskauf.md",
      line: 12,
      text: "Die Grundschuld steht im Exposé",
      place: null,
    },
    {
      path: "projects/Hauskauf/Exposé Mehrfamilienhaus.pdf",
      line: 88,
      text: "Grundschuld: 250.000 EUR, eingetragen 2019",
      place: { kind: "pdf", label: "page 3", page: 3, anchor: null },
    },
    {
      path: "projects/Hauskauf/Exposé Mehrfamilienhaus.pdf",
      line: 140,
      text: "Löschung der Grundschuld bei Übergabe",
      place: { kind: "pdf", label: "page 7", page: 7, anchor: null },
    },
    {
      path: "reading/Expecting Better.epub",
      line: 912,
      text: "a Grundschuld is not the only thing a buyer inherits",
      place: { kind: "epub", label: "Chapter 4: Caffeine, 41%", page: null, anchor: null },
    },
    {
      path: "projects/Hauskauf/Finanzierungsrechner.html",
      line: 20,
      text: "Grundschuld und Zinsbindung",
      place: { kind: "html", label: "Annahmen", page: null, anchor: "annahmen" },
    },
  ] satisfies SearchHit[]
).map((hit) => ({ ...hit, date: "2026-10-26", tags: [] }));

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

/** One picture of `panel` at one size and theme, once `ready` holds. */
async function shoot(
  name: string,
  size: Size,
  theme: Theme,
  panel: ReactNode,
  query: string,
): Promise<void> {
  searchNotes.mockResolvedValue(HITS);
  fetchMentions.mockResolvedValue([]);
  fetchTodos.mockResolvedValue([]);
  fetchNote.mockResolvedValue("# Hauskauf\n\nDie Grundschuld steht im Exposé.\n");

  await page.viewport(size.width, size.height);
  await commands.emulateMedia({ touch: size.coarse, reducedMotion: "reduce" });
  stubMatchMedia({ [NARROW]: size.width < 768, [COARSE]: size.coarse });
  localStorage.clear();
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, "poel");
  applyTheme();

  const host = document.body.appendChild(document.createElement("div"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(<QueryClientProvider client={client}>{panel}</QueryClientProvider>);
    });
    const input = host.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: query } });
    await waitFor(
      () => expect(host.querySelectorAll('[role="option"]').length).toBeGreaterThan(2),
      PATIENCE,
    );
    // The finder previews the second row, a pdf, so the file preview shows.
    if (name.startsWith("finder") && !size.coarse) fireEvent.keyDown(input, { key: "ArrowDown" });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await Promise.all(document.getAnimations().map((animation) => animation.finished));

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
    expect(await shot(dialog, name)).toBe(size.width);
  } finally {
    root.unmount();
    host.remove();
    await commands.emulateMedia({});
  }
}

const finder = (
  <NoteFinder paths={NOTES} files={FILES} vaultNotes={NOTES} onOpen={() => {}} onClose={() => {}} />
);
const search = <NoteSearch onOpen={() => {}} onClose={() => {}} archive={false} />;

for (const [label, size] of [
  ["1440", DESKTOP],
  ["414", PHONE],
] as const) {
  for (const theme of ["light", "dark"] as const) {
    it.skipIf(!SHOTS)(
      `finder-files-${label}-${theme}`,
      () => shoot(`finder-files-${label}-${theme}`, size, theme, finder, "e"),
      300_000,
    );
    it.skipIf(!SHOTS)(
      `search-files-${label}-${theme}`,
      () => shoot(`search-files-${label}-${theme}`, size, theme, search, "grundschuld"),
      300_000,
    );
  }
}
