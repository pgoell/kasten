import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNote } from "@/lib/core/api";
import { EXERCISE_DRAG } from "@/lib/log/training/block/block-calendar";
import { blockCard } from "@/lib/log/training/block/block-card";
import { fetchBlocks } from "@/lib/log/training/block/blocks";
import { type Exercise, fetchExercises, fetchTraining } from "@/lib/log/training/exercises";
import { parseTrainingLine } from "@/lib/log/training/training-lines";
import { notePath } from "@/lib/todo/todo-commands";

/** The block card (#1719): the calendar, the library and its drag, and the next block. */

vi.mock("@/lib/core/api", async (actual) => ({
  ...(await actual<object>()),
  createNote: vi.fn(),
}));
vi.mock("@/lib/log/training/block/blocks", async (actual) => ({
  ...(await actual<object>()),
  fetchBlocks: vi.fn(),
}));
vi.mock("@/lib/log/training/exercises", async (actual) => ({
  ...(await actual<object>()),
  fetchExercises: vi.fn(),
  fetchTraining: vi.fn(),
}));

const FOLDER = "03 Areas/11 Fitness/Blöcke/";
const NOTE = `---
type: Training Block
start: 2026-11-02
weeks: 2
---
# Block 2026-11 Grundlage

## Weeks
- 1: RPE 7
- 2: deload

## Sessions
### A
- [[Kniebeuge]] 3x8, +2.5 kg, 80 kg

## Days
- Mon: A
`;

function exercise(name: string, muscles: string[]): Exercise {
  return {
    path: `x/${name}.md`,
    name,
    kind: "strength",
    counts: "weight-reps",
    aliases: [],
    muscles_primary: muscles,
    muscles_secondary: [],
    equipment: [],
  };
}

function mount(): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: NOTE,
      extensions: [notePath.of(`${FOLDER}Block 2026-11 Grundlage.md`), blockCard],
    }),
    parent: document.body,
  });
}

function day(label: RegExp): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".cm-block-day")].find((cell) =>
    label.test(cell.getAttribute("aria-label") ?? ""),
  );
  if (found === undefined) throw new Error(`no day ${String(label)}`);
  return found;
}

describe("the block card", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-11-11T18:00:00") });
    vi.mocked(fetchExercises)
      .mockReset()
      .mockResolvedValue([
        exercise("Kniebeuge", ["quadriceps"]),
        exercise("Rudern", ["upper-back"]),
      ]);
    vi.mocked(fetchTraining)
      .mockReset()
      .mockResolvedValue([
        {
          date: "2026-11-02",
          entries: [parseTrainingLine("- 🏋 [[Kniebeuge]] 82.5 kg 8 8 8")].flatMap((e) => e ?? []),
        },
        {
          date: "2026-11-04",
          entries: [parseTrainingLine("- 🏃 [[Joggen]] 30 min 5 km")].flatMap((e) => e ?? []),
        },
      ]);
    vi.mocked(fetchBlocks).mockReset().mockResolvedValue([]);
    vi.mocked(createNote)
      .mockReset()
      .mockResolvedValue({} as never);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("draws the weeks with done, planned, deload and cardio days", async () => {
    mount();
    await vi.waitFor(() => expect(document.querySelector(".cm-block-lib")).not.toBeNull());

    expect(document.querySelector(".cm-block-standing")?.textContent).toBe(
      "Week 2 of 2 · deload · rest day",
    );
    expect(day(/^Mon 2 Nov/).classList.contains("is-done")).toBe(true);
    expect(day(/^Mon 9 Nov/).classList).toContain("is-planned");
    expect(day(/^Mon 9 Nov/).classList).toContain("is-deload");
    expect(day(/^Wed 4 Nov/).getAttribute("aria-label")).toBe("Wed 4 Nov, rest day, cardio");
    expect(fetchTraining).toHaveBeenCalledWith("2026-11-02", "2026-11-15");
  });

  it("adds a picked or dropped exercise to the day's session, and filters by muscle", async () => {
    const view = mount();
    await vi.waitFor(() => expect(document.querySelector(".cm-block-item")).not.toBeNull());
    const muscle = document.querySelector<HTMLSelectElement>(".cm-block-muscle");
    if (muscle === null) throw new Error("no filter");
    muscle.value = "upper-back";
    muscle.dispatchEvent(new Event("change"));
    const items = [...document.querySelectorAll(".cm-block-item")].map((i) => i.textContent);
    expect(items).toEqual(["Rudern"]);

    document.querySelector<HTMLButtonElement>(".cm-block-item")?.click();
    day(/^Mon 9 Nov/).click();
    expect(view.state.doc.toString()).toContain(
      "- [[Kniebeuge]] 3x8, +2.5 kg, 80 kg\n- [[Rudern]] 3x8-12, double\n",
    );

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: [EXERCISE_DRAG], getData: () => "Kniebeuge" },
    });
    day(/^Thu 5 Nov/).dispatchEvent(drop);
    expect(view.state.doc.toString()).toContain("### B\n- [[Kniebeuge]] 3x8-12, double\n");
    expect(view.state.doc.toString()).toContain("- Mon: A\n- Thu: B\n");
  });

  it("offers the next block in the last week and writes it beside this one", async () => {
    mount();
    const next = await vi.waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>(".cm-block-next");
      if (found === null) throw new Error("no button yet");
      return found;
    });
    next.click();

    await vi.waitFor(() =>
      expect(document.querySelector(".cm-block-said")?.textContent).toBe(
        "Wrote [[Block 2026-11-16 Grundlage]]",
      ),
    );
    expect(document.querySelector(".cm-block-next")).toBeNull();
    const [path, text] = vi.mocked(createNote).mock.calls[0] ?? [];
    expect(path).toBe(`${FOLDER}Block 2026-11-16 Grundlage.md`);
    expect(text).toContain("start: 2026-11-16");
    expect(text).toContain("- [[Kniebeuge]] 3x8, +2.5 kg, 82.5 kg");
  });
});
