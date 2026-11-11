import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBlocks } from "@/lib/log/training/block/blocks";
import { exerciseCard } from "@/lib/log/training/exercise/exercise-card";
import { fetchTraining } from "@/lib/log/training/exercises";
import { parseTrainingLine } from "@/lib/log/training/training-lines";
import { notePath } from "@/lib/todo/todo-commands";

/** The card on an exercise note (#1721): video, map, history and the phone's tabs. */

vi.mock("@/lib/log/training/block/blocks", async (actual) => ({
  ...(await actual<object>()),
  fetchBlocks: vi.fn(),
}));
vi.mock("@/lib/log/training/exercises", async (actual) => ({
  ...(await actual<object>()),
  fetchTraining: vi.fn(),
}));

const NOTE = `---
kind: strength
muscles_primary: [quadriceps, gluteal]
muscles_secondary: [hamstring]
video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
---
# Kniebeuge

- Füße schulterbreit
`;

function mount(doc = NOTE): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [notePath.of("03 Areas/Übungen/Kniebeuge.md"), exerciseCard],
    }),
    parent: document.body,
  });
}

function day(date: string, line: string) {
  return { date, entries: [parseTrainingLine(line)].flatMap((e) => e ?? []) };
}

describe("the exercise card", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-11-11T18:00:00") });
    vi.mocked(fetchTraining)
      .mockReset()
      .mockResolvedValue([
        day("2026-10-26", "- 🏋 [[Kniebeuge]] 80 kg 8 8 8"),
        day("2026-11-09", "- 🏋 [[Kniebeuge]] 85 kg 8 8 7"),
      ]);
    vi.mocked(fetchBlocks).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("plays the video, paints the muscles and reads the history", async () => {
    mount();
    await vi.waitFor(() => expect(document.querySelector(".cm-exercise-history")).not.toBeNull());

    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(document.querySelector(".cm-exercise-legend")?.textContent).toBe(
      "primary: quadriceps, gluteal · secondary: hamstring",
    );
    const heads = [...document.querySelectorAll(".cm-exercise-head")].map((h) => h.textContent);
    expect(heads[0]).toMatch(/^Estimated 1RM · \d/);
    expect(heads).toContain("Last sets");
    expect(document.querySelector(".cm-exercise-trend polyline")).not.toBeNull();
    const last = [...document.querySelectorAll(".cm-exercise-list li")].map((li) => li.textContent);
    expect(last).toEqual(["9 Nov85 kg · 8 8 7", "26 Oct80 kg · 8 8 8"]);
    expect(fetchTraining).toHaveBeenCalledWith("2025-11-11", "2026-11-11");
  });

  it("keeps the video while the body is typed in, and switches tabs", async () => {
    const view = mount();
    await vi.waitFor(() => expect(document.querySelector(".cm-exercise-history")).not.toBeNull());
    const frame = document.querySelector("iframe");

    view.dispatch({ changes: { from: view.state.doc.length, insert: "- Knie nach außen\n" } });
    expect(document.querySelector("iframe")).toBe(frame);

    const history = [...document.querySelectorAll<HTMLButtonElement>(".cm-exercise-tab")].find(
      (tab) => tab.textContent === "History",
    );
    history?.click();
    expect(document.querySelector<HTMLElement>(".cm-exercise")?.dataset.tab).toBe("history");
    expect(document.querySelector(".cm-exercise-tab[aria-selected=true]")?.textContent).toBe(
      "History",
    );
    expect(document.querySelector("iframe")).toBe(frame);
  });

  it("is no card without a kind", () => {
    mount("---\ntype: Reference\n---\n# Kniebeuge\n");
    expect(document.querySelector(".cm-exercise")).toBeNull();
    expect(fetchTraining).not.toHaveBeenCalled();
  });
});
