import { ARCHIVE, inArchive } from "@/lib/archive";
import { clipPage } from "@/lib/clip";
import { IMAGE_FOLDER } from "@/lib/image";
import {
  applyLayout,
  INBOX,
  ARCHIVE as LAYOUT_ARCHIVE,
  IMAGE_FOLDER as LAYOUT_IMAGES,
  type Layout,
  PERIODIC,
} from "@/lib/layout";
import { bookNote, importedNote } from "@/lib/note-path";
import { ONTOLOGY_NOTE } from "@/lib/ontology";
import { dailyDate, periodicNote } from "@/lib/periodic";
import { VIEWS_NOTE } from "@/lib/todo-view";
import { wikiLinkPath } from "@/lib/wikilink";

/**
 * A vault laid out by somebody else, as `GET /api/layout` would name it.
 *
 * Every other test runs on the defaults and pins them. These prove the served
 * names reach every reader, through the re-exports as well as the direct ones.
 */
const FRIEND: Layout = {
  inbox: "Inbox",
  periodic: "Journal (mine)",
  archive: "Archive",
  images: "Attachments",
  config: "Meta",
};

const DEFAULTS: Layout = {
  inbox: INBOX,
  periodic: PERIODIC,
  archive: LAYOUT_ARCHIVE,
  images: LAYOUT_IMAGES,
  config: "99 Misc/01 Config",
};

describe("a layout the backend served", () => {
  beforeEach(() => {
    applyLayout(FRIEND);
  });

  afterEach(() => {
    applyLayout(DEFAULTS);
  });

  it("files a note made from a bare name in the served inbox", () => {
    expect(wikiLinkPath("borges", [])).toBe("Inbox/borges.md");
    expect(importedNote("Borges.md")).toBe("Inbox/Borges.md");
    expect(bookNote("Ulysses.epub")?.note).toBe("Inbox/02 Books/Ulysses.md");
    expect(bookNote("paper.pdf")?.book).toBe("Inbox/02 Documents/paper.pdf");
  });

  it("clips a page into the served inbox", () => {
    const html = "<html><head><title>A post</title></head><body><p>text</p></body></html>";

    expect(clipPage(html, "https://example.com/post").path).toBe("Inbox/A post.md");
  });

  it("makes the periodic notes under the served folder", () => {
    const day = new Date(2026, 7, 10);
    const note = periodicNote("daily", day);

    expect(note.path).toBe("Journal (mine)/00 Daily/2026-08-10.md");
    expect(note.body).toContain("[[Journal (mine)/01 Weekly/2026-W33]]");
    expect(periodicNote("yearly", day).path).toBe("Journal (mine)/04 Yearly/2026.md");
  });

  it("reads a day off a path in the served folder, brackets and all", () => {
    expect(dailyDate("Journal (mine)/00 Daily/2026-08-10.md")).toBe("2026-08-10");
    expect(dailyDate("01 Periodic/00 Daily/2026-08-10.md")).toBeNull();
  });

  it("leaves the served archive out, live through the re-export", () => {
    expect(ARCHIVE).toBe("Archive");
    expect(inArchive("Archive/old.md")).toBe(true);
    expect(inArchive("98 Archive/old.md")).toBe(false);
  });

  it("puts images and the config notes where the vault keeps them", () => {
    expect(IMAGE_FOLDER).toBe("Attachments");
    expect(ONTOLOGY_NOTE).toBe("Meta/01 Agents/Ontology.md");
    expect(VIEWS_NOTE).toBe("Meta/todo-views.md");
  });
});
