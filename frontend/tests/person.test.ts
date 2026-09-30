/**
 * What the vault says about one person, read off the lines that link them.
 *
 * No DOM and no queries: every promise the card makes is a rule about strings,
 * which is the reason the reading sits in `lib/person.ts` rather than in the
 * component drawing it. The one rule worth the whole module is the last group
 * here: a name in prose is not a link, and a card must not read it as one.
 */

import type { SearchHit } from "@/lib/api";
import { isPerson, meetings, personDone, personTodos } from "@/lib/person";

const MAX = "03 Areas/08 People/Max Bosch.md";
const OTHER = "03 Areas/08 People/Max Degenkolbe.md";

/** The vault the links resolve against: two people of one first name, and a meeting. */
const PATHS = [
  MAX,
  OTHER,
  "02 Projects/FDE/2026-09-28 FDE Check-in.md",
  "01 Periodic/00 Daily/2026-09-30.md",
];

function hit(path: string, line: number, text: string): SearchHit {
  return { path, line, text };
}

describe("isPerson", () => {
  it("reads the type out of the frontmatter", () => {
    expect(isPerson("---\ntype: Person\n---\n# Max Bosch\n")).toBe(true);
  });

  it("says no to every other note, and to one with no block at all", () => {
    expect(isPerson("---\ntype: Note\n---\n# Max Bosch\n")).toBe(false);
    expect(isPerson("# Max Bosch\n")).toBe(false);
  });
});

describe("personTodos", () => {
  it("keeps the open todos linking them, soonest due first", () => {
    const found = personTodos(
      [
        hit("a.md", 3, "- [ ] ask [[Max Bosch]] about the script 📅 2026-10-08"),
        hit("a.md", 4, "- [ ] send [[Max Bosch]] the repo 📅 2026-10-02"),
        hit("a.md", 5, "- [ ] write the brief for [[Max Bosch]]"),
      ],
      MAX,
      PATHS,
    );

    expect(found.map((one) => one.todo.text)).toEqual([
      "send [[Max Bosch]] the repo",
      "ask [[Max Bosch]] about the script",
      "write the brief for [[Max Bosch]]",
    ]);
  });

  it("drops the finished, the rejected and the lines that are not todos", () => {
    const found = personTodos(
      [
        hit("a.md", 1, "- [x] paid [[Max Bosch]] back ✅ 2026-09-20"),
        hit("a.md", 2, "- [-] ask [[Max Bosch]] again"),
        hit("a.md", 3, "- [[Max Bosch]] joins on Monday"),
        hit("a.md", 4, "- [ ] brief [[Max Bosch]]"),
      ],
      MAX,
      PATHS,
    );

    expect(found.map((one) => one.hit.line)).toEqual([4]);
  });
});

describe("meetings", () => {
  const DATED = "02 Projects/FDE/2026-09-28 FDE Check-in.md";

  it("takes the dated notes linking them, most recent first", () => {
    const found = meetings(
      [
        hit("02 Projects/FDE/2026-09-18 Enablement.md", 7, "[[Max Bosch]] and me"),
        hit(DATED, 7, "[[Max Bosch]] and me, 20 min"),
        hit("02 Projects/FDE/index.md", 2, "the project [[Max Bosch]] runs"),
      ],
      MAX,
      PATHS,
      3,
    );

    expect(found.map((one) => one.date)).toEqual(["2026-09-28", "2026-09-18"]);
    // The line that named them, so opening the meeting lands on the attendees.
    expect(found[0]?.line).toBe(7);
  });

  it("counts a note once however often it links them, and keeps the newest", () => {
    const found = meetings(
      [
        hit(DATED, 7, "[[Max Bosch]] and me"),
        hit(DATED, 19, "[[Max Bosch]] takes the script"),
        hit("02 Projects/FDE/2026-09-18 Enablement.md", 7, "with [[Max Bosch]]"),
        hit("02 Projects/FDE/2026-08-11 Kickoff.md", 7, "with [[Max Bosch]]"),
      ],
      MAX,
      PATHS,
      2,
    );

    expect(found.map((one) => one.path)).toEqual([
      DATED,
      "02 Projects/FDE/2026-09-18 Enablement.md",
    ]);
  });
});

describe("personDone", () => {
  it("takes the log lines naming them, most recently done first", () => {
    const found = personDone(
      [
        hit("01 Periodic/00 Daily/2026-09-30.md", 49, "- ✅ 2026-09-22 brief [[Max Bosch]] kt-1"),
        hit("01 Periodic/00 Daily/2026-09-30.md", 50, "- ✅ 2026-09-29 pay [[Max Bosch]] kt-2"),
        hit("01 Periodic/00 Daily/2026-09-30.md", 51, "- [ ] ask [[Max Bosch]]"),
      ],
      MAX,
      PATHS,
      5,
    );

    expect(found.map((one) => one.date)).toEqual(["2026-09-29", "2026-09-22"]);
    expect(found[0]?.text).toBe("pay [[Max Bosch]] kt-2");
  });

  it("keeps no more than it was asked for", () => {
    const lines = ["2026-09-30", "2026-09-29", "2026-09-28"].map((date, at) =>
      hit("01 Periodic/00 Daily/2026-09-30.md", at, `- ✅ ${date} saw [[Max Bosch]]`),
    );

    expect(personDone(lines, MAX, PATHS, 2)).toHaveLength(2);
  });
});

describe("a name is not a link", () => {
  it("leaves out the line that only mentions them", () => {
    const lines = [
      hit("a.md", 1, "- [ ] ask Max Bosch about the script"),
      hit("a.md", 2, "- ✅ 2026-09-29 asked Max Bosch"),
      hit("02 Projects/FDE/2026-09-28 FDE Check-in.md", 7, "Max Bosch and me, 20 min"),
    ];

    expect(personTodos(lines, MAX, PATHS)).toEqual([]);
    expect(personDone(lines, MAX, PATHS, 5)).toEqual([]);
    expect(meetings(lines, MAX, PATHS, 3)).toEqual([]);
  });

  it("leaves out the other person of the same first name", () => {
    const lines = [hit("a.md", 1, "- [ ] ask [[Max Degenkolbe]] about the rota")];

    expect(personTodos(lines, MAX, PATHS)).toEqual([]);
    expect(personTodos(lines, OTHER, PATHS)).toHaveLength(1);
  });
});
