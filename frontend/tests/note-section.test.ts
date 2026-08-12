import { appendUnder } from "@/lib/note-section";

/** Today's daily note as the vault holds it, log line and all. */
const DAILY = [
  "# 2026-08-10 Monday",
  "",
  "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
  "",
  "## Done",
  "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
  "",
  "## Time",
  "- 09:12-10:32 read the spec",
  "",
].join("\n");

describe("appendUnder", () => {
  it("puts the line at the end of the section, above the heading after it", () => {
    expect(appendUnder(DAILY, "## Done", "- ✅ 2026-08-10 buy milk kt-000002")).toBe(
      [
        "# 2026-08-10 Monday",
        "",
        "[[01 Periodic/00 Daily/2026-08-09]] | [[01 Periodic/00 Daily/2026-08-11]]",
        "",
        "## Done",
        "- ✅ 2026-08-10 read the spec [[projects/kasten]] kt-000001",
        "- ✅ 2026-08-10 buy milk kt-000002",
        "",
        "## Time",
        "- 09:12-10:32 read the spec",
        "",
      ].join("\n"),
    );
  });

  it("makes the section at the end of a note that has none", () => {
    const note = ["# 2026-08-10 Monday", "", "[[01 Periodic/00 Daily/2026-08-09]]", ""].join("\n");

    expect(appendUnder(note, "## Done", "- ✅ 2026-08-10 buy milk kt-000002")).toBe(
      [
        "# 2026-08-10 Monday",
        "",
        "[[01 Periodic/00 Daily/2026-08-09]]",
        "",
        "## Done",
        "- ✅ 2026-08-10 buy milk kt-000002",
        "",
      ].join("\n"),
    );
  });
});
