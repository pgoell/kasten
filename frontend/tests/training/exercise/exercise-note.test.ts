import { describe, expect, it } from "vitest";
import { parseBlock } from "@/lib/log/training/block/block-note";
import { blocksWith, lastDays } from "@/lib/log/training/exercise/exercise-history";
import { listField, readExercise, videoOf } from "@/lib/log/training/exercise/exercise-note";
import { muscleMap } from "@/lib/log/training/exercise/muscle-map";
import { parseTrainingLine } from "@/lib/log/training/training-lines";

/** The exercise page (#1721): what the note holds, the map it paints, the history it reads. */

const NOTE = `---
type: Reference
kind: Strength
muscles_primary: [chest]
muscles_secondary:
  - triceps
  - chest
  - "front-deltoids"
video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
---
# Bankdrücken LH
`;

describe("reading an exercise note", () => {
  it("reads kind, muscles in both list shapes, and the video", () => {
    expect(readExercise(NOTE)).toEqual({
      kind: "strength",
      primary: ["chest"],
      secondary: ["triceps", "front-deltoids"],
      video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(listField("---\nequipment: []\n---\n", "equipment")).toEqual([]);
    expect(readExercise("---\nkind: recipe\n---\n")).toBeNull();
    expect(readExercise("---\ntype: Reference\n---\n")).toBeNull();
  });

  it("plays YouTube without cookies and a video file as it is, nothing else", () => {
    expect(videoOf("https://youtu.be/dQw4w9WgXcQ")).toEqual({
      kind: "youtube",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    const file = "https://wger.de/media/exercise-video/192/a.mp4";
    expect(videoOf(file)).toEqual({ kind: "file", src: file });
    expect(videoOf("http://wger.de/a.mp4")).toBeNull();
    expect(videoOf("https://vimeo.com/123")).toBeNull();
    expect(videoOf("https://example.com/a.mp4")).toBeNull();
    expect(videoOf("")).toBeNull();
  });
});

describe("the muscle map", () => {
  it("paints primary dark, secondary light, and says both in words", () => {
    const map = muscleMap(["chest", "calves"], ["triceps"]);
    const painted = (role: string) =>
      new Set([...map.querySelectorAll(`.${role}`)].map((p) => (p as SVGElement).dataset.muscle));
    expect(painted("is-primary")).toEqual(new Set(["chest", "calves"]));
    expect(painted("is-secondary")).toEqual(new Set(["triceps"]));
    // Both soleus parts on the back belong to the calves.
    const back = map.querySelector('[data-side="back"]');
    expect(back?.querySelectorAll(".is-primary").length).toBeGreaterThanOrEqual(4);
    expect(map.getAttribute("aria-label")).toBe(
      "Muscles, primary: chest, calves; secondary: triceps",
    );
    expect(muscleMap([], []).textContent).toBe("No muscles named");
  });
});

describe("the history", () => {
  it("lists the last days of any kind and the blocks that plan the exercise", () => {
    const day = (date: string, line: string) => ({
      date,
      entries: [parseTrainingLine(line)].flatMap((e) => e ?? []),
    });
    const days = [
      day("2026-11-02", "- 🏋 [[Bankdrücken LH]] 60 kg 8 8 7"),
      day("2026-11-04", "- 🏃 [[Joggen]] 32 min 5 km"),
    ];
    expect(lastDays(days, "Bankdrücken LH")).toEqual([
      { date: "2026-11-02", words: "60 kg · 8 8 7" },
    ]);
    expect(lastDays(days, "Joggen")).toEqual([{ date: "2026-11-04", words: "32 min · 5 km" }]);

    const text = (start: string) =>
      `---\ntype: Training Block\nstart: ${start}\n---\n## Sessions\n### A\n- [[Bankdrücken LH]] 3x8\n## Cardio\n- 🏃 [[Joggen]] 60 min\n`;
    const held = ["2026-10-05", "2026-11-02"].map((start) => {
      const block = parseBlock(text(start));
      if (block === null) throw new Error("no block");
      return { path: `B/Block ${start}.md`, text: text(start), block };
    });
    expect(blocksWith(held, "Bankdrücken LH")).toEqual([
      { name: "Block 2026-11-02", path: "B/Block 2026-11-02.md", where: ["session A"] },
      { name: "Block 2026-10-05", path: "B/Block 2026-10-05.md", where: ["session A"] },
    ]);
    expect(blocksWith(held, "Joggen")[0]?.where).toEqual(["cardio"]);
    expect(blocksWith(held, "Kniebeuge")).toEqual([]);
  });
});
