/**
 * Pictures of the book pane (#789), to look at by eye: a lone pane at 1440 by 900
 * with its contents and note columns, a passage just taken with its mark and
 * toast, the phone at 414 by 896 with touch and a selection held, the cover page,
 * and the other three palettes.
 *
 * Skipped unless VITE_KASTEN_SHOTS=1; pictures land in node_modules/.cache/kasten-shots.
 */

import "./html-take-api";
// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "@fontsource-variable/newsreader/opsz.css";
import { page as browserPage, commands, userEvent } from "vitest/browser";
import type { Palette, Theme } from "@/lib/theme";
import coverUrl from "../fixtures/cover.epub?url";
import { chooseTheme, clickInside, located, sections } from "./book-pane-fixture";
import {
  columnsSettled,
  marksIn,
  mountBooks,
  paneOf,
  sectionOf,
  takeIn,
  toastIn,
  until,
} from "./book-take-fixture";
import { api, type Mounted, setUp, tearDown } from "./html-take-fixture";
import { shot } from "./shots";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const DESKTOP = { width: 1440, height: 900, touch: false };
const PHONE = { width: 414, height: 896, touch: true };
type Size = typeof DESKTOP;

const { fetchBook } = vi.hoisted(() => ({ fetchBook: vi.fn() }));
// Only the book's bytes are faked. The note and the rest go through the stubbed vault.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchBook,
}));

const NOTE = "20 Literature/Cover.md";
/** The top of chapter one, the second `itemref`, which skips the cover page. */
const CHAPTER_ONE = "epubcfi(/6/4!/4/2/1:0)";
/** Two passages of chapter one: the first paragraph, and the one with the line art and the photo. */
const FIRST = "The first chapter, in body text the stylesheet paints black.";
const ART = "Black line art on a transparent background sits above, an opaque photo below.";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The note with a reading place and the passages already taken, in the shape the take writes. */
function noteWith(reading: string, quotes: string[]): string {
  const frontmatter = `---\nid: one\n${reading ? `reading: ${reading}\n` : ""}---\n# Cover\n`;
  if (quotes.length === 0) return frontmatter;
  const blocks = quotes.map((quote, i) => `> ${quote}\n\nOne ^hl-00000${i + 1}\n`);
  return `${frontmatter}\n## Highlights\n\n${blocks.join("\n")}`;
}

/** Selects the whole text of the first paragraph that starts with `start`, the way a drag over it does. */
function selectParagraph(doc: Document, start: string): void {
  const paragraph = [...doc.querySelectorAll("p")].find((p) =>
    (p.textContent ?? "").startsWith(start),
  );
  const node = paragraph?.firstChild as Node;
  const selection = doc.defaultView?.getSelection() as Selection;
  selection.removeAllRanges();
  selection.setBaseAndExtent(node, 0, node, node.textContent?.length ?? 0);
}

/** Clicks into the chapter at `#plain`, so the pane holds the focus a selection needs. */
async function focusChapter(mounted: Mounted, doc: Document): Promise<void> {
  await until(() => columnsSettled(paneOf(mounted, NOTE)));
  await clickInside(paneOf(mounted, NOTE), doc, "#plain");
}

/** One picture of the pane at `size`, `theme` and `palette`, after `act` has put the book in its state. */
async function picture(
  name: string,
  size: Size,
  theme: Theme,
  palette: Palette,
  note: string,
  act: (doc: Document, mounted: Mounted) => Promise<void>,
): Promise<void> {
  sections.length = 0;
  located.length = 0;
  fetchBook.mockResolvedValue({
    path: NOTE.replace(/\.md$/, ".epub"),
    blob: await (await fetch(coverUrl)).blob(),
  });
  const mounted = await setUp();
  try {
    await browserPage.viewport(size.width, size.height);
    await commands.emulateMedia({
      touch: size.touch,
      reducedMotion: "no-preference",
      contrast: "no-preference",
      reducedTransparency: "no-preference",
    });
    chooseTheme(theme, palette);
    api.notes[NOTE] = note;
    mountBooks(mounted, [NOTE]);
    const doc = await sectionOf(NOTE);
    await act(doc, mounted);

    await document.fonts.ready;
    await nextFrame();
    const element = paneOf(mounted, NOTE);
    // The picture is checked against the pane's own width, as the pdf pictures are.
    const width = await shot(element, name);
    expect(width).toBe(Math.round(element.getBoundingClientRect().width));
  } finally {
    await tearDown(mounted);
  }
}

/** The lone desktop pane, opened at chapter one with two passages taken and the columns settled. */
async function desktopWith(_doc: Document, mounted: Mounted): Promise<void> {
  await vi.waitFor(() => expect(marksIn(mounted, NOTE)).toHaveLength(2), { timeout: 20_000 });
  // The columns come after the text, once the pane has measured itself.
  await vi.waitFor(() => expect(columnsSettled(paneOf(mounted, NOTE))).toBe(true), {
    timeout: 20_000,
  });
}

/** A passage selected and taken with `y`, so the mark and the toast are on the page. */
async function takenPassage(doc: Document, mounted: Mounted): Promise<void> {
  await vi.waitFor(() => expect(marksIn(mounted, NOTE)).toHaveLength(1), { timeout: 20_000 });
  await focusChapter(mounted, doc);
  selectParagraph(doc, ART);
  await vi.waitFor(() => expect(takeIn(mounted, NOTE)).not.toBeNull());
  await userEvent.keyboard("y");
  await vi.waitFor(() => expect(toastIn(mounted, NOTE)).toContain("Taken into the book's note"));
  await vi.waitFor(() => expect(marksIn(mounted, NOTE)).toHaveLength(2));
}

/** A passage selected on the phone and held, so the footer shows its Take and Contents. */
async function heldOnPhone(doc: Document, mounted: Mounted): Promise<void> {
  await vi.waitFor(() => expect(marksIn(mounted, NOTE)).toHaveLength(1), { timeout: 20_000 });
  await focusChapter(mounted, doc);
  selectParagraph(doc, ART);
  await vi.waitFor(() =>
    expect(paneOf(mounted, NOTE).querySelector("footer [data-take]")).not.toBeNull(),
  );
}

function shotTest(name: string, run: () => Promise<void>) {
  it.skipIf(!SHOTS)(name, run, 300_000);
}

const TWO = noteWith(CHAPTER_ONE, [FIRST, ART]);
const ONE = noteWith(CHAPTER_ONE, [FIRST]);

shotTest("book-1440-light", () =>
  picture("book-1440-light", DESKTOP, "light", "poel", TWO, desktopWith),
);
shotTest("book-1440-dark", () =>
  picture("book-1440-dark", DESKTOP, "dark", "poel", TWO, desktopWith),
);
shotTest("book-take-1440-light", () =>
  picture("book-take-1440-light", DESKTOP, "light", "poel", ONE, takenPassage),
);
shotTest("book-take-1440-dark", () =>
  picture("book-take-1440-dark", DESKTOP, "dark", "poel", ONE, takenPassage),
);
shotTest("book-414-light", () =>
  picture("book-414-light", PHONE, "light", "poel", ONE, heldOnPhone),
);
shotTest("book-414-dark", () => picture("book-414-dark", PHONE, "dark", "poel", ONE, heldOnPhone));
shotTest("book-cover-1440-dark", () =>
  picture("book-cover-1440-dark", DESKTOP, "dark", "poel", noteWith("", []), async (doc) => {
    // The cover is the picture of the page, so the page waits until its image has loaded.
    await vi.waitFor(
      () => expect((doc.querySelector("#cover") as HTMLImageElement).complete).toBe(true),
      { timeout: 20_000 },
    );
  }),
);
for (const palette of ["russet", "peach", "pansy"] as const) {
  shotTest(`book-1440-${palette}`, () =>
    picture(`book-1440-${palette}`, DESKTOP, "light", palette, TWO, desktopWith),
  );
}
