/**
 * The three columns of a book pane at desktop width, in real Chromium (#789): a
 * lone pane at 1440 shows the contents and the note beside the text, and the text
 * keeps to the reading measure between them.
 */

import "./html-take-api";
import plainUrl from "../fixtures/plain.epub?url";
import { located, sections } from "./book-pane-fixture";
import { mountBooks, PLAIN, paneOf, sectionOf, until } from "./book-take-fixture";
import { api, type Mounted, setUp, tearDown } from "./html-take-fixture";

const { fetchBook } = vi.hoisted(() => ({ fetchBook: vi.fn() }));
// Only the book's bytes are faked. The note and the rest go through the stubbed vault.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchBook,
}));

const NOTE = "20 Literature/Plain.md";

let mounted: Mounted;

beforeEach(async () => {
  located.length = 0;
  sections.length = 0;
  mounted = await setUp();
  const bytes = await (await fetch(plainUrl)).blob();
  fetchBook.mockResolvedValue({ path: NOTE.replace(/\.md$/, ".epub"), blob: bytes });
});

afterEach(async () => {
  await tearDown(mounted);
});

describe("the columns of a book pane", () => {
  it("at 1440 a lone pane shows the contents and the note columns, and the text stays at the measure", async () => {
    api.notes[NOTE] = PLAIN;
    mountBooks(mounted, [NOTE]);
    const doc = await sectionOf(NOTE);
    const pane = paneOf(mounted, NOTE);

    // The pane measures itself after the first paint, so the columns come after the text.
    await until(() => pane.querySelector('nav[aria-label="Book contents"]') !== null);

    expect.soft(pane.querySelector('nav[aria-label="Book contents"]')).not.toBeNull();
    expect.soft(pane.querySelector('section[aria-label="Taken"]')).not.toBeNull();
    expect.soft(Math.round(doc.body.getBoundingClientRect().width)).toBe(680);
  }, 30_000);
});
