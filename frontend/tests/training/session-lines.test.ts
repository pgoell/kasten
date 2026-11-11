// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  cardioEdit,
  dayLabel,
  heldEdit,
  setEdit,
  setLabel,
  setsOf,
} from "@/lib/log/training/session-lines";
import {
  hasTraining,
  parseTrainingLine,
  type TrainingEntry,
  trainingLines,
} from "@/lib/log/training/training-lines";
import type { Edit } from "@/lib/notes/text/note-section";

const DAY = "---\ntype: Periodic Note\n---\n\n# 2026-11-11\n\n## Log\n- 💧 250 ml\n";

function apply(text: string, edit: Edit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

function entry(line: string): TrainingEntry {
  const parsed = parseTrainingLine(line);
  if (parsed === null) throw new Error(`no entry: ${line}`);
  return parsed;
}

describe("setEdit", () => {
  it("makes the section and the line for the first set", () => {
    const text = apply(DAY, setEdit(DAY, { exercise: "Kniebeuge", kg: 80, reps: 8, rpe: 7 }));

    expect(text).toBe(`${DAY}\n## Training\n- 🏋 [[Kniebeuge]] 80 kg 8 @7\n`);
  });

  it("extends the last line at the same weight and takes the new set's RPE", () => {
    let text = DAY;
    for (const [reps, rpe] of [
      [8, 7],
      [8, 8],
      [7, 9],
    ] as const) {
      text = apply(text, setEdit(text, { exercise: "Kniebeuge", kg: 80, reps, rpe }));
    }

    expect(text.endsWith("## Training\n- 🏋 [[Kniebeuge]] 80 kg 8 8 7 @9\n")).toBe(true);
    expect(setsOf(text, "Kniebeuge").map(setLabel)).toEqual([
      "80 kg × 8 @9",
      "80 kg × 8 @9",
      "80 kg × 7 @9",
    ]);
  });

  it("starts a new line when the weight changes, and keeps other exercises apart", () => {
    let text = `${DAY}\n## Training\n- 🏋 [[Kniebeuge]] 80 kg 8\n- 🚲 [[Radfahren]] 25 min\n\n## Dump\nx\n`;
    text = apply(text, setEdit(text, { exercise: "Kniebeuge", kg: 82.5, reps: 6, rpe: null }));
    text = apply(text, setEdit(text, { exercise: "Klimmzüge", kg: null, reps: 5, rpe: null }));
    text = apply(text, setEdit(text, { exercise: "Klimmzüge", kg: null, reps: 4, rpe: 9 }));

    expect(text).toContain(
      "## Training\n- 🏋 [[Kniebeuge]] 80 kg 8\n- 🚲 [[Radfahren]] 25 min\n" +
        "- 🏋 [[Kniebeuge]] 82.5 kg 6\n- 🏋 [[Klimmzüge]] bw 5 4 @9\n\n## Dump\nx\n",
    );
  });

  it("keeps the line's RPE when the new set has none, and its alias and marker as written", () => {
    const text = `## Training\n- 🏋️ [[Kniebeuge|Squat]] 80 kg 8 @8\n`;

    const next = apply(text, setEdit(text, { exercise: "Kniebeuge", kg: 80, reps: 7, rpe: null }));

    expect(next).toBe("## Training\n- 🏋️ [[Kniebeuge|Squat]] 80 kg 8 7 @8\n");
  });
});

describe("trainingLines", () => {
  it("reads every exact ## Training and skips a ### training before it", () => {
    const text = `${DAY}\n### training\n- 🏋 [[Dips]] bw 5\n\n## Training\n- 🏋 [[Kniebeuge]] 80 kg 8\n\n## Notes\n- 🏋 [[Plank]] 1x 45 s\n\n## Training\n- 🚶 [[Gehen]] 30 min\n`;

    expect(trainingLines(text).map(({ entry: e }) => e.exercise)).toEqual(["Kniebeuge", "Gehen"]);
    const extended = apply(
      text,
      setEdit(text, { exercise: "Kniebeuge", kg: 80, reps: 7, rpe: null }),
    );
    expect(extended).toContain("- 🏋 [[Kniebeuge]] 80 kg 8 7\n");
    expect(setsOf(extended, "Kniebeuge")).toHaveLength(2);
  });

  it("marks a training day by the same reader", () => {
    expect(hasTraining(`${DAY}\n### training\n- 🏋 [[Dips]] bw 5\n`)).toBe(false);
    expect(
      hasTraining(`${DAY}\n### training\n- note\n\n## Training\n- 🏋 [[Kniebeuge]] 80 kg 8\n`),
    ).toBe(true);
  });
});

describe("heldEdit and cardioEdit", () => {
  it("counts a held set up when the time matches, else starts a line", () => {
    let text = "## Training\n";
    text = apply(text, heldEdit(text, "Plank", 45));
    text = apply(text, heldEdit(text, "Plank", 45));
    text = apply(text, heldEdit(text, "Plank", 60));

    expect(text).toBe("## Training\n- 🏋 [[Plank]] 2x 45 s\n- 🏋 [[Plank]] 1x 60 s\n");
    expect(setsOf(text, "Plank").map(setLabel)).toEqual(["45 s", "45 s", "60 s"]);
  });

  it("writes a ride with and without its distance, and both parse", () => {
    let text = "## Training\n";
    text = apply(text, cardioEdit(text, "ride", "Radfahren", 25, 8.2));
    text = apply(text, cardioEdit(text, "walk", "Gehen", 40, null));

    expect(text).toBe("## Training\n- 🚲 [[Radfahren]] 25 min 8.2 km\n- 🚶 [[Gehen]] 40 min\n");
    expect(text.split("\n").slice(1, 3).map(parseTrainingLine)).not.toContain(null);
  });
});

describe("dayLabel", () => {
  it("shows a day's lines for one exercise in short", () => {
    const entries = [
      entry("- 🏋 [[K]] 80 kg 8 7 7 @8"),
      entry("- 🏋 [[K]] bw 5"),
      entry("- 🏋 [[K]] 3x 45 s"),
    ];

    expect(dayLabel(entries)).toBe("80 kg · 8 7 7, bw · 5, 3× 45 s");
  });
});
