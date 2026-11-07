// @vitest-environment node
import {
  grouped,
  type LibraryBook,
  lastRead,
  linkTo,
  namingCurrent,
  nextStatus,
  shelfName,
  withHidden,
  withStatus,
} from "@/components/books/library";

function book(over: Partial<LibraryBook>): LibraryBook {
  return {
    path: "Books/01 Technical/DDIA.md",
    title: "DDIA",
    author: "Martin Kleppmann",
    folder: "Books/01 Technical",
    status: "unread",
    chosen: false,
    progress: null,
    read_at: null,
    created: null,
    hidden: false,
    highlights: 0,
    current: false,
    format: "epub",
    ...over,
  };
}

const BOOKS = [
  book({ title: "Old", status: "reading", read_at: "2026-10-01T10:00:00+00:00" }),
  book({ title: "New", status: "reading", read_at: "2026-11-05T10:00:00+00:00" }),
  book({ title: "Alpha", status: "unread" }),
  book({ title: "Zulu", status: "want" }),
  book({ title: "Done", status: "finished", read_at: "2026-09-01T10:00:00+00:00" }),
  book({ title: "Gone", status: "dropped", hidden: true, author: "Someone Else" }),
];

const titles = (groups: ReturnType<typeof grouped>) =>
  groups.map((group) => [group.name, group.books.map((each) => each.title)]);

it("groups books by where you are with them, newest read first", () => {
  expect(titles(grouped(BOOKS, "", false))).toEqual([
    ["Reading", ["New", "Old"]],
    ["Up next", ["Zulu", "Alpha"]],
    ["Done", ["Done"]],
  ]);
});

it("leaves hidden books out until asked for them", () => {
  expect(titles(grouped(BOOKS, "", true)).at(-1)).toEqual(["Done", ["Done", "Gone"]]);
});

it("filters on every word, over title, author and shelf", () => {
  expect(titles(grouped(BOOKS, "someone", true))).toEqual([["Done", ["Gone"]]]);
  expect(titles(grouped(BOOKS, "technical new", false))).toEqual([["Reading", ["New"]]]);
  expect(grouped(BOOKS, "nothing like it", true)).toEqual([]);
});

it("names a shelf without its sort number", () => {
  expect(shelfName("04 Ressources/01 Books/03 Parenting")).toBe("Parenting");
  expect(shelfName("Books")).toBe("Books");
  expect(shelfName("")).toBe("Vault");
});

it("steps the status round the four a note may choose", () => {
  expect(nextStatus("unread")).toBe("want");
  expect(nextStatus("want")).toBe("reading");
  expect(nextStatus("dropped")).toBe("want");
});

it("writes status and hidden into the block, keeping the rest", () => {
  const text = "---\ntype: Book\n---\n# DDIA\n";
  expect(withStatus(text, "finished")).toBe("---\ntype: Book\nstatus: finished\n---\n# DDIA\n");
  const hidden = withHidden(text, true);
  expect(hidden).toContain("hidden: true");
  expect(withHidden(hidden, false)).toContain("hidden: false");
});

it("links by name, or by path where another note shares the name", () => {
  expect(linkTo("Books/DDIA.md", ["Books/DDIA.md", "x.md"])).toBe("[[DDIA]]");
  expect(linkTo("Books/DDIA.md", ["Archive/DDIA.md", "Books/DDIA.md"])).toBe("[[Books/DDIA]]");
});

it("swaps the first link of the current-book note and keeps what was written around it", () => {
  expect(namingCurrent("Now: [[Old]] and [[Other]]\n", "[[New]]")).toBe(
    "Now: [[New]] and [[Other]]\n",
  );
  expect(namingCurrent("nothing yet\n", "[[New]]")).toBe("[[New]]\nnothing yet\n");
});

it("says when a book was last read in words", () => {
  const today = new Date("2026-11-06T12:00:00");
  expect(lastRead(book({ read_at: "2026-11-06T08:00:00" }), today)).toBe("today");
  expect(lastRead(book({ read_at: "2026-11-05T22:00:00" }), today)).toBe("yesterday");
  expect(lastRead(book({ read_at: null }), today)).toBeNull();
  expect(lastRead(book({ read_at: "not a time" }), today)).toBeNull();
});
