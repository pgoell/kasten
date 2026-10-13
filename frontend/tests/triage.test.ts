import { inboxNotes, vaultFolders } from "@/lib/triage";

describe("inboxNotes", () => {
  it("keeps nested notes, drops the folder's own index and log, and keeps order", () => {
    const files = [
      "00 Inbox/b.md",
      "00 Inbox/index.md",
      "00 Inbox/sub/a.md",
      "00 Inbox/log.md",
      "01 Periodic/2026-10-13.md",
    ];

    expect(inboxNotes(files, "00 Inbox")).toEqual(["00 Inbox/b.md", "00 Inbox/sub/a.md"]);
  });

  it("drops the index of a nested folder as well as the inbox's own", () => {
    const files = ["00 Inbox/sub/index.md", "00 Inbox/sub/a.md"];

    expect(inboxNotes(files, "00 Inbox")).toEqual(["00 Inbox/sub/a.md"]);
  });

  it("does not take a folder that only starts with the inbox name", () => {
    expect(inboxNotes(["00 Inbox2/x.md"], "00 Inbox")).toEqual([]);
  });
});

describe("vaultFolders", () => {
  it("skips the inbox, and any skipped folder with what sits under it", () => {
    const files = [
      "00 Inbox/a.md",
      "99 Misc/01 Config/c.md",
      "99 Misc/01 Config/deep/d.md",
      "99 Misc/e.md",
      "reading/f.md",
    ];

    expect(vaultFolders(files, ["00 Inbox", "99 Misc/01 Config"])).toEqual([
      { path: "99 Misc", examples: ["e"] },
      { path: "reading", examples: ["f"] },
    ]);
  });

  it("ignores notes at the vault root", () => {
    expect(vaultFolders(["root.md"], [])).toEqual([]);
  });

  it("caps the examples at five, without the suffix", () => {
    const files = ["a/1.md", "a/2.md", "a/3.md", "a/4.md", "a/5.md", "a/6.md"];

    expect(vaultFolders(files, [])).toEqual([{ path: "a", examples: ["1", "2", "3", "4", "5"] }]);
  });

  it("leaves the folder's index out of the examples even when it comes first", () => {
    const files = ["a/index.md", "a/1.md", "a/2.md", "a/3.md", "a/4.md", "a/5.md", "a/6.md"];

    expect(vaultFolders(files, [])).toEqual([{ path: "a", examples: ["1", "2", "3", "4", "5"] }]);
  });

  it("lists a folder holding only an index with no examples", () => {
    expect(vaultFolders(["a/index.md", "a/log.md"], [])).toEqual([{ path: "a", examples: [] }]);
  });

  it("skips the inbox by its name and not by a longer name that starts with it", () => {
    expect(vaultFolders(["00 Inbox/a.md", "00 Inbox2/b.md"], ["00 Inbox"])).toEqual([
      { path: "00 Inbox2", examples: ["b"] },
    ]);
  });

  it("lists nested folders as their own entries, sorted by path", () => {
    const files = ["reading/x/y.md", "reading/z.md", "archive/w.md"];

    expect(vaultFolders(files, []).map((folder) => folder.path)).toEqual([
      "archive",
      "reading",
      "reading/x",
    ]);
  });
});
