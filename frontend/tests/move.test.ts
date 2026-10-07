import { dropTarget } from "@/lib/move";

describe("dropTarget", () => {
  it("puts a note inside the folder it was dropped on", () => {
    expect(dropTarget("inbox/borges.md", "rename", "reading")).toBe("reading/borges.md");
  });

  it("puts a note at the vault root", () => {
    expect(dropTarget("inbox/borges.md", "rename", "")).toBe("borges.md");
  });

  it("moves nothing when the note is already there", () => {
    expect(dropTarget("reading/borges.md", "rename", "reading")).toBeUndefined();
  });

  it("puts a folder inside another", () => {
    expect(dropTarget("projects/kasten", "folder", "archive")).toBe("archive/kasten");
  });

  it("refuses a folder dropped on itself or inside itself", () => {
    expect(dropTarget("projects", "folder", "projects")).toBeUndefined();
    expect(dropTarget("projects", "folder", "projects/kasten")).toBeUndefined();
  });

  it("keeps a folder's sibling with a longer name as a place to drop", () => {
    expect(dropTarget("project", "folder", "projects")).toBe("projects/project");
  });
});
