import { describeNotePath } from "@/lib/note-path";

const PATHS = ["daily/2026-08-05.md", "index.md", "projects/kasten/api-design.md"];

describe("describeNotePath", () => {
  it("has nothing to say about an empty input", () => {
    expect(describeNotePath("", PATHS)).toEqual({ kind: "empty" });
  });

  it("takes an input of only whitespace for an empty one", () => {
    expect(describeNotePath("   ", PATHS)).toEqual({ kind: "empty" });
  });

  it("trims what is typed around the path", () => {
    expect(describeNotePath("  kasten  ", PATHS)).toEqual({ kind: "create", path: "kasten.md" });
  });

  it("waits for a name when the input ends in a slash", () => {
    expect(describeNotePath("reading/", PATHS)).toEqual({
      kind: "blocked",
      reason: "name the note",
    });
  });

  it("blocks a name starting with a dot", () => {
    expect(describeNotePath(".hidden", PATHS)).toEqual({
      kind: "blocked",
      reason: "a name cannot start with a dot",
    });
  });

  it("blocks a folder starting with a dot", () => {
    expect(describeNotePath(".jj/note", PATHS)).toEqual({
      kind: "blocked",
      reason: "a name cannot start with a dot",
    });
  });

  it("appends .md to a bare name", () => {
    expect(describeNotePath("kasten", PATHS)).toEqual({ kind: "create", path: "kasten.md" });
  });

  it("leaves an .md that is already there", () => {
    expect(describeNotePath("kasten.md", PATHS)).toEqual({ kind: "create", path: "kasten.md" });
  });

  it("appends .md after any other suffix", () => {
    // The vault holds markdown, so a `.txt` is part of the name and not a
    // second guess at the file type.
    expect(describeNotePath("kasten.txt", PATHS)).toEqual({
      kind: "create",
      path: "kasten.txt.md",
    });
  });

  it("opens a note the vault already has", () => {
    expect(describeNotePath("index", PATHS)).toEqual({ kind: "open", path: "index.md" });
  });

  it("opens a note named in full", () => {
    expect(describeNotePath("daily/2026-08-05.md", PATHS)).toEqual({
      kind: "open",
      path: "daily/2026-08-05.md",
    });
  });

  it("names the folder a new note would bring with it", () => {
    expect(describeNotePath("reading/borges", PATHS)).toEqual({
      kind: "create",
      path: "reading/borges.md",
      newFolder: "reading/",
    });
  });

  it("names no folder when the one asked for is already there", () => {
    expect(describeNotePath("daily/note", PATHS)).toEqual({
      kind: "create",
      path: "daily/note.md",
    });
  });

  it("names no folder for a note at the vault root", () => {
    expect(describeNotePath("kasten", PATHS)).not.toHaveProperty("newFolder");
  });
});
