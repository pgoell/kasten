import { history } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNote } from "@/lib/api";
import { logCard } from "@/lib/log/log-card";
import { parseConfig } from "@/lib/log/log-kinds";
import { paletteEntries } from "@/lib/palette";
import { notePath } from "@/lib/todo/todo-commands";
import { stubCommands } from "./stub-commands";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote: vi.fn(),
}));
vi.mock("@/lib/log/food-api", () => ({
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
  fetchLog: vi.fn(async () => []),
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = "# 2026-10-20 Tuesday\n\n## Log\n- 💧 500 ml\n\n## Done\n- [ ] write";
const WEIGHT = "- 💧 water: 250 ml\n- ☕ coffee: 1\n- 🍺 alcohol: 1\n- ⚖ weight: kg, last";

const mounted: EditorView[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

describe("the palette's weight entry", () => {
  it("#805 I4 Log weight over a daily note's card asks on the card and writes no line", async () => {
    vi.mocked(fetchNote).mockResolvedValue(WEIGHT);
    const parent = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({
        doc: NOTE,
        extensions: [notePath.of(DAILY), history(), logCard],
      }),
      parent,
    });
    mounted.push(view);
    // The defaults draw first, so wait for the weight button the config note adds.
    await vi.waitFor(() =>
      expect(view.dom.querySelector(".cm-log button[aria-label='Log weight']")).not.toBeNull(),
    );

    const commands = stubCommands();
    const entry = paletteEntries(commands, view, parseConfig(WEIGHT).kinds).find(
      (row) => row.label === "Log weight",
    );
    expect(entry).toBeDefined();
    entry?.run();

    expect(view.state.doc.toString()).toBe(NOTE);
    expect(view.dom.querySelector(".cm-log-why")?.textContent).toBe("Type the weight in kg");
    expect(commands.logDrink).not.toHaveBeenCalled();
    expect(commands.openDaily).not.toHaveBeenCalled();
  });

  it("#805 I4 Log weight away from a card hands the ask to today's note and writes no line", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: NOTE, extensions: [notePath.of("kasten.md")] }),
    });
    const commands = stubCommands();
    const entry = paletteEntries(commands, view, parseConfig(WEIGHT).kinds).find(
      (row) => row.label === "Log weight",
    );
    expect(entry).toBeDefined();
    entry?.run();

    expect(commands.logWeight).toHaveBeenCalledWith("⚖");
    expect(commands.logDrink).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe(NOTE);
  });
});
