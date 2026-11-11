import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Exercise, fetchEarlier, fetchExercises } from "@/lib/log/training/exercises";
import { summary, trainingCard } from "@/lib/log/training/training-card";
import { parseTrainingLine, type TrainingEntry } from "@/lib/log/training/training-lines";
import { notePath } from "@/lib/todo/todo-commands";

/** The session screen (#1717): pick, sets written as tapped, the rest timer, cardio. */

vi.mock("@/lib/log/training/exercises", async (actual) => ({
  ...(await actual<object>()),
  fetchExercises: vi.fn(),
  fetchEarlier: vi.fn(),
}));

const DAY = "2026-11-11";
const PATH = `01 Periodic/00 Daily/${DAY}.md`;

function exercise(name: string, over: Partial<Exercise> = {}): Exercise {
  return {
    path: `03 Areas/11 Fitness/Übungen/${name}.md`,
    name,
    kind: "strength",
    counts: "weight-reps",
    aliases: [],
    muscles_primary: ["quadriceps"],
    muscles_secondary: [],
    equipment: [],
    ...over,
  };
}

const LIBRARY = [
  exercise("Kniebeuge", { aliases: ["Squat"] }),
  exercise("Klimmzüge", { counts: "reps", muscles_primary: ["upper-back"] }),
  exercise("Plank", { counts: "time", muscles_primary: ["abs"] }),
  exercise("Radfahren", { kind: "cardio", counts: "time", muscles_primary: [] }),
  exercise("Knie-zur-Wand", { kind: "test" }),
];

function entry(line: string): TrainingEntry {
  const parsed = parseTrainingLine(line);
  if (parsed === null) throw new Error(`no entry: ${line}`);
  return parsed;
}

function mount(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [notePath.of(PATH), history(), trainingCard] }),
    parent: document.body,
  });
  return view;
}

function press(name: string | RegExp): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".k-train button")];
  const label = (b: HTMLButtonElement) =>
    b.getAttribute("aria-label") ??
    b.querySelector(".k-train-item-name")?.textContent ??
    b.textContent ??
    "";
  const found = buttons.find((b) =>
    typeof name === "string" ? label(b) === name : name.test(label(b)),
  );
  if (found === undefined) throw new Error(`no button ${String(name)}`);
  found.click();
}

async function openFrom(view: EditorView): Promise<void> {
  const start = view.dom.querySelector<HTMLButtonElement>(".cm-training-start");
  start?.click();
  await vi.waitFor(() => expect(document.querySelector(".k-train-item")).not.toBeNull());
}

describe("the session screen", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(`${DAY}T18:00:00`) });
    vi.mocked(fetchExercises).mockReset().mockResolvedValue(LIBRARY);
    vi.mocked(fetchEarlier)
      .mockReset()
      .mockResolvedValue([
        { date: "2026-11-08", entries: [entry("- 🏋 [[Kniebeuge]] 80 kg 8 7 7 @8")] },
      ]);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("shows the card on today's note and opens with recent exercises first, tests left out", async () => {
    const view = mount(`# ${DAY}\n\nRest.\n`);
    expect(view.dom.querySelector(".cm-training-words")?.textContent).toBe(
      "No training logged yet",
    );

    await openFrom(view);

    const names = [...document.querySelectorAll(".k-train-item-name")].map((n) => n.textContent);
    expect(names[0]).toBe("Kniebeuge");
    expect(names).not.toContain("Knie-zur-Wand");
    expect(fetchEarlier).toHaveBeenCalledWith(DAY);
  });

  it("writes each set at once, extends the line, rests 2:00 with +30 s, and one undo takes one set", async () => {
    const view = mount(`# ${DAY}\n`);
    await openFrom(view);
    press("Kniebeuge");

    expect(document.querySelector(".k-train-last")?.textContent).toBe("Last time 80 kg · 8 7 7");
    expect(document.querySelector(".k-train-value")?.textContent).toBe("80 kg");
    press("Weight up 2.5");
    press("8");
    press(/^Set done/);
    expect(view.state.doc.toString()).toBe(
      `# ${DAY}\n\n## Training\n- 🏋 [[Kniebeuge]] 82.5 kg 8 @8\n`,
    );
    expect(document.querySelector(".k-train-rest-clock")?.textContent).toBe("2:00");
    press("+30 s");
    expect(document.querySelector(".k-train-rest-clock")?.textContent).toBe("2:30");
    press("Go");
    expect((document.querySelector(".k-train-rest") as HTMLElement).hidden).toBe(true);

    press("Reps down 1");
    press(/^Set done/);
    expect(view.state.doc.toString()).toContain("- 🏋 [[Kniebeuge]] 82.5 kg 8 7 @8\n");
    expect(document.querySelectorAll(".k-train-set")).toHaveLength(2);

    undo(view);
    expect(view.state.doc.toString()).toContain("- 🏋 [[Kniebeuge]] 82.5 kg 8 @8\n");
  });

  it("skips an exercise without writing, and logs body weight, held sets and a ride", async () => {
    const view = mount(`# ${DAY}\n\n## Training\n`);
    await openFrom(view);
    press("Kniebeuge");
    press("Skip exercise");
    expect(view.state.doc.toString()).toBe(`# ${DAY}\n\n## Training\n`);

    press("Klimmzüge");
    press(/^Set done/);
    press("Next exercise");
    press("Plank");
    press(/^Set done/);
    press("Next exercise");
    press("Ride");
    press("Minutes down 5");
    for (let at = 0; at < 16; at += 1) press("Distance up 0.5");
    press("Save");

    expect(view.state.doc.toString()).toBe(
      `# ${DAY}\n\n## Training\n- 🏋 [[Klimmzüge]] bw 8\n- 🏋 [[Plank]] 1x 45 s\n- 🚲 [[Radfahren]] 25 min 8 km\n`,
    );
    expect(view.dom.querySelector(".cm-training-words")?.textContent).toBe(
      "2 exercises · 2 sets · 25 min cardio",
    );
    expect(document.querySelectorAll(".k-train-segment")).toHaveLength(4);
  });

  it("finds an exercise by an alias", async () => {
    const view = mount(`# ${DAY}\n`);
    await openFrom(view);
    const search = document.querySelector<HTMLInputElement>(".k-train-search");
    if (search === null) throw new Error("no search");
    search.value = "squ";
    search.dispatchEvent(new Event("input"));

    const names = [...document.querySelectorAll(".k-train-item-name")].map((n) => n.textContent);
    expect(names).toEqual(["Kniebeuge"]);
  });
});

describe("summary", () => {
  it("is null before the first line", () => {
    expect(summary([])).toBeNull();
  });
});
