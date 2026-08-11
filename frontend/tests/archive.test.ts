import { ARCHIVE, inArchive, visible } from "@/lib/archive";

describe("inArchive", () => {
  it("reads a note under the archive as archived", () => {
    expect(inArchive(`${ARCHIVE}/old.md`)).toBe(true);
  });

  it("reads one nested deeper under it as archived", () => {
    expect(inArchive(`${ARCHIVE}/certs/ccao-f.md`)).toBe(true);
  });

  it("reads an archive folder nested in the vault as archived, the way rg does", () => {
    expect(inArchive(`projects/${ARCHIVE}/old.md`)).toBe(true);
  });

  it("leaves a folder that merely starts with the name alone", () => {
    expect(inArchive("98 Archived plans/live.md")).toBe(false);
  });

  it("leaves a note named like the archive alone, the archive being a folder", () => {
    expect(inArchive("98 Archive.md")).toBe(false);
  });

  it("leaves an ordinary note alone", () => {
    expect(inArchive("projects/kasten.md")).toBe(false);
  });
});

describe("visible", () => {
  const paths = ["projects/kasten.md", `${ARCHIVE}/old.md`, "98 Archived plans/live.md"];

  it("drops the archive when it has not been asked for", () => {
    expect(visible(paths, false)).toEqual(["projects/kasten.md", "98 Archived plans/live.md"]);
  });

  it("hands back every note once it has", () => {
    expect(visible(paths, true)).toEqual(paths);
  });
});
