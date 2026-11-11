// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addToDay,
  editBetween,
  nextBlockText,
  nextName,
  nextStart,
} from "@/lib/log/training/block/block-edit";
import {
  cardioMinutes,
  endOf,
  parseBlock,
  planOn,
  targetLabel,
  weeklyCardio,
} from "@/lib/log/training/block/block-note";
import { blockOn, blockWeeks, hasNext } from "@/lib/log/training/block/blocks";
import { parseTrainingLine } from "@/lib/log/training/training-lines";

/** The block note (#1719): read, the targets a day gets, and the writes. */

const NOTE = `---
type: Training Block
start: 2026-11-16
weeks: 4
---

# Block 2026-11 Grundlage

## Weeks
- 1: RPE 7
- 2: RPE 8
- 3: RPE 8-9
- 4: deload

## Sessions
### A
- [[Kniebeuge]] 3x8-10, double, 80 kg
- [[Bankdrücken]] 3x5 @8, +2.5 kg, 60 kg
### B
- [[Klimmzug]] 3x6, +1 rep, bw
- [[Plank]] 3x45 s

## Days
- Mon: A
- Thu: B

## Cardio
- 🚶 [[Gehen]] 150 min
- 🏃 [[Joggen]] long 30 min
`;

function block() {
  const read = parseBlock(NOTE);
  if (read === null) throw new Error("no block");
  return read;
}

describe("reading a block note", () => {
  it("reads weeks, sessions, days and cardio", () => {
    const b = block();
    expect(b.start).toBe("2026-11-16");
    expect(endOf(b)).toBe("2026-12-13");
    expect(b.weeks.map((w) => w.deload)).toEqual([false, false, false, true]);
    expect(b.weeks[2]?.rpe).toBe("8-9");
    expect(b.days).toEqual(["A", null, null, "B", null, null, null]);
    expect(b.sessions.get("A")?.[0]).toMatchObject({
      exercise: "Kniebeuge",
      sets: 3,
      low: 8,
      high: 10,
      rule: "double",
      kg: 80,
    });
    expect(b.sessions.get("A")?.[1]).toMatchObject({ rule: "kg", step: 2.5, kg: 60, rpe: 8 });
    expect(b.sessions.get("B")?.[1]).toMatchObject({ held: true, low: 45 });
    expect(weeklyCardio(b)).toBe(150);
  });

  it("is no block without the type or a start", () => {
    expect(parseBlock("# Block\n")).toBeNull();
    expect(parseBlock("---\ntype: Training Block\n---\n")).toBeNull();
    // Any case and quotes, as the backend lists them.
    expect(parseBlock("---\ntype: 'training block'\nstart: \"2026-11-16\"\n---\n")?.start).toBe(
      "2026-11-16",
    );
  });
});

describe("the targets of a day", () => {
  it("climbs by the rule each build week and eases in the deload", () => {
    const b = block();
    const weeks = ["2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"].map(
      (date) => planOn(b, date)?.targets ?? [],
    );
    expect(weeks.map((t) => targetLabel(t[0] as never))).toEqual([
      "3 × 8 · 80 kg @7",
      "3 × 9 · 80 kg @8",
      "3 × 10 · 80 kg @8",
      "2 × 8 · 47.5 kg",
    ]);
    expect(weeks.map((t) => t[1]?.kg)).toEqual([60, 62.5, 65, 40]);
    expect(planOn(b, "2026-11-19")?.targets.map(targetLabel)).toEqual([
      "3 × 6 · bw @7",
      "3 × 45 s @7",
    ]);
    expect(planOn(b, "2026-11-17")).toMatchObject({ week: 0, letter: null, targets: [] });
    expect(planOn(b, "2026-12-14")).toBeNull();
  });

  it("grows the long session by a tenth and holds it in the deload", () => {
    const b = block();
    const long = b.cardio[1];
    if (long === undefined) throw new Error("no long session");
    expect([0, 1, 2, 3].map((week) => cardioMinutes(b, long, week))).toEqual([30, 33, 36, 36]);
  });
});

describe("writing a block note", () => {
  it("adds an exercise to the session on a day, or a new session", () => {
    const b = block();
    const squat = { name: "Ausfallschritt", counts: "weight-reps" as const };
    const onMonday = addToDay(NOTE, b, 0, squat);
    expect(onMonday).toContain(
      "- [[Bankdrücken]] 3x5 @8, +2.5 kg, 60 kg\n- [[Ausfallschritt]] 3x8-12, double\n### B",
    );
    const onSaturday = addToDay(NOTE, b, 5, { name: "Dips", counts: "reps" });
    expect(onSaturday).toContain(
      "- [[Plank]] 3x45 s\n### C\n- [[Dips]] 3x8, +1 rep, bw\n\n## Days",
    );
    expect(onSaturday).toContain("- Thu: B\n- Sat: C\n");
    expect(parseBlock(onSaturday)?.days[5]).toBe("C");
  });

  it("is one edit between two texts", () => {
    expect(editBetween("abcd", "abXd")).toEqual({ from: 2, to: 3, insert: "X" });
    expect(editBetween("ab", "abc")).toEqual({ from: 2, to: 2, insert: "c" });
  });

  it("plans the next block with the weights the last weeks logged", () => {
    const b = block();
    const days = [
      {
        date: "2026-11-30",
        entries: [parseTrainingLine("- 🏋 [[Kniebeuge]] 85 kg 10 10 9")].flatMap((e) => e ?? []),
      },
    ];
    const next = nextBlockText(`---\nid: x1\n${NOTE.slice(4)}`, b, days, "2026-12-10");
    expect(next).toContain("start: 2026-12-14");
    expect(next).not.toContain("id: x1");
    expect(next).toContain("- [[Kniebeuge]] 3x8-10, double, 85 kg");
    expect(next).toContain("- [[Bankdrücken]] 3x5 @8, +2.5 kg, 65 kg");
    expect(next).toContain("- [[Klimmzug]] 3x6, +1 rep, bw");
    expect(next).toContain("- 🏃 [[Joggen]] long 30 min");
    expect(nextStart(b, "2026-12-30")).toBe("2027-01-04");
    expect(nextName("Block 2026-11 Grundlage", "2026-12-14")).toBe("Block 2026-12 Grundlage");
    expect(nextName("Block 2026-11 Grundlage", "2026-11-30")).toBe("Block 2026-11-30 Grundlage");
    expect(nextName("Grundlage", "2026-12-14")).toBe("Grundlage 2026-12");
  });
});

describe("the blocks around a day", () => {
  it("finds the block on a day, the next one, and its weeks", () => {
    const first = { block: block() };
    const later = { block: { ...block(), start: "2026-12-14" } };
    expect(blockOn([first, later], "2026-11-20")).toBe(first);
    expect(blockOn([first, later], "2027-02-01")).toBeNull();
    expect(hasNext([first], first.block)).toBe(false);
    expect(hasNext([first, later], first.block)).toBe(true);
    expect(blockWeeks([first], ["2026-11-09", "2026-12-07"])).toEqual([
      { deload: null, cardio: null },
      { deload: true, cardio: 150 },
    ]);
  });
});
