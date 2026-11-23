// @vitest-environment node
import { QueryClient } from "@tanstack/react-query";
import type { TodoRow } from "@/lib/core/api";
import {
  addSubtaskInVault,
  addTodoInVault,
  agentTodoInVault,
  blockTodoInVault,
  cycleTodoInVault,
  editTodoInVault,
  noteLineOf,
  toggleTimerInVault,
} from "@/lib/todo/todo-api";

// Each pane write is one store call; the store applies the rules, so only the call is asserted.
const api = vi.hoisted(() => ({
  addTodoLine: vi.fn(),
  changeTodoLine: vi.fn(),
  cycleStoreTodo: vi.fn(),
  patchTodo: vi.fn(),
  setTodoState: vi.fn(),
  toggleTodoTimer: vi.fn(),
}));
vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  ...api,
}));

const hit = (text: string, line = 1) => ({ path: "a.md", line, text });
const ROW = { id: "kt-aaaaaa", version: 4, blocked_by: [] as string[] } as TodoRow;

beforeEach(() => {
  for (const each of Object.values(api)) each.mockReset().mockResolvedValue([]);
});

describe("the todo writes", () => {
  it("cycles by the line's id, and sets a named state through its own route", async () => {
    await cycleTodoInVault(hit("- [ ] a 🆔 kt-aaaaaa"));
    await cycleTodoInVault(hit("- [ ] a 🆔 kt-aaaaaa"), "waiting");
    expect(api.cycleStoreTodo).toHaveBeenCalledExactlyOnceWith("kt-aaaaaa");
    expect(api.setTodoState).toHaveBeenCalledExactlyOnceWith("kt-aaaaaa", "waiting");
  });

  it("sends nothing setting the state the todo is in", async () => {
    await cycleTodoInVault(hit("- [x] a 🆔 kt-aaaaaa"), "done");
    expect(api.setTodoState).not.toHaveBeenCalled();
  });

  it("refuses a line that names no todo", async () => {
    await expect(cycleTodoInVault(hit("- [ ] a"))).rejects.toThrow("that line names no todo");
  });

  it("starts a timer from a running session's line too", async () => {
    await toggleTimerInVault(hit("- 14:03- a kt-bbbbbb", 100_001));
    expect(api.toggleTodoTimer).toHaveBeenCalledExactlyOnceWith("kt-bbbbbb");
  });

  it("puts an edited line as typed, at the version its row is listed at", async () => {
    await editTodoInVault({ ...hit("- [ ] a 🆔 kt-aaaaaa"), todo: ROW }, "- [ ] b ⏫ 🆔 kt-aaaaaa");
    expect(api.changeTodoLine).toHaveBeenCalledExactlyOnceWith(
      "kt-aaaaaa",
      "- [ ] b ⏫ 🆔 kt-aaaaaa",
      4,
    );
  });

  it("sends a blocked line whose last ⛔ the edit took off as open", async () => {
    await editTodoInVault(hit("- [b] a ⛔ kt-bbbbbb 🆔 kt-aaaaaa"), "- [b] a 🆔 kt-aaaaaa", 4);
    expect(api.changeTodoLine).toHaveBeenCalledExactlyOnceWith(
      "kt-aaaaaa",
      "- [ ] a 🆔 kt-aaaaaa",
      4,
    );
  });

  it("#2247 sends the version the edit read, past a press from here but not past a change from elsewhere", async () => {
    const listed = {
      ...hit("- [ ] a 🆔 kt-cccccc"),
      todo: { ...ROW, id: "kt-cccccc", version: 9 },
    };
    await editTodoInVault(listed, "- [ ] b 🆔 kt-cccccc", 7);
    api.cycleStoreTodo.mockResolvedValueOnce([{ ...ROW, id: "kt-cccccc", version: 8 }]);
    const pressed = cycleTodoInVault(listed);
    await editTodoInVault(listed, "- [ ] c 🆔 kt-cccccc", 7);
    await pressed;
    expect(api.changeTodoLine.mock.calls.map((call) => call[2])).toEqual([7, 8]);
    await expect(editTodoInVault(hit("- [ ] d 🆔 kt-dddddd"), "- [ ] e")).rejects.toThrow(
      "that todo is not in the list yet",
    );
  });

  it("forgets its own written versions once 200 newer ones came after", async () => {
    const listed = { ...hit("- [ ] a 🆔 kt-eeeeee"), todo: { ...ROW, id: "kt-eeeeee" } };
    api.cycleStoreTodo.mockResolvedValueOnce([{ ...ROW, id: "kt-eeeeee", version: 2 }]);
    await cycleTodoInVault(listed);
    await editTodoInVault(listed, "- [ ] b 🆔 kt-eeeeee", 1);
    for (let n = 0; n < 200; n += 1) {
      api.cycleStoreTodo.mockResolvedValueOnce([{ ...ROW, id: `kt-f${n}`, version: 1 }]);
      await cycleTodoInVault(hit(`- [ ] f 🆔 kt-f${n}`));
    }
    await editTodoInVault(listed, "- [ ] c 🆔 kt-eeeeee", 1);
    expect(api.changeTodoLine.mock.calls.map((call) => call[2])).toEqual([2, 1]);
  });

  it("takes the id off the row before the line, which a press drawn early can leave plain", async () => {
    await cycleTodoInVault({ ...hit("a ✅ 2026-08-10"), todo: ROW });
    expect(api.cycleStoreTodo).toHaveBeenCalledExactlyOnceWith("kt-aaaaaa");
  });

  it("adds the shorthand as a line, under the parent for a part", async () => {
    await addTodoInVault("call mum !1", "2026-08-10");
    await addSubtaskInVault(hit("- [ ] a 🆔 kt-aaaaaa"), "buy card", "2026-08-10");
    expect(api.addTodoLine.mock.calls).toEqual([
      [expect.stringMatching(/^- \[ \] call mum/)],
      ["- [ ] buy card ➕ 2026-08-10", { parent_id: "kt-aaaaaa" }],
    ]);
  });

  it("adds the blocker's id at the version listed", async () => {
    await blockTodoInVault(hit("- [ ] a 🆔 kt-aaaaaa"), hit("- [ ] b 🆔 kt-bbbbbb", 2), () => ROW);
    expect(api.patchTodo).toHaveBeenCalledExactlyOnceWith("kt-aaaaaa", {
      version: 4,
      blocked_by: ["kt-bbbbbb"],
    });
  });

  it("tags the line #agent, and takes the tag back off an open todo", async () => {
    const open = () => ({ ...ROW, state: "open" }) as TodoRow;
    await agentTodoInVault(
      hit("- [ ] a 🆔 kt-aaaaaa"),
      ["- [ ] a 🆔 kt-aaaaaa"],
      "2026-08-10",
      open,
    );
    await agentTodoInVault(
      hit("- [ ] a #agent 🆔 kt-aaaaaa"),
      ["- [ ] a #agent 🆔 kt-aaaaaa"],
      "2026-08-10",
      open,
    );
  });

  it("#2084 tags the todo in the state its row has now, not the box the press read", async () => {
    const doing = () => ({ ...ROW, state: "doing" }) as TodoRow;
    await agentTodoInVault(
      hit("- [ ] a 🆔 kt-aaaaaa"),
      ["- [ ] a 🆔 kt-aaaaaa"],
      "2026-08-10",
      doing,
    );
    expect(api.changeTodoLine).toHaveBeenCalledExactlyOnceWith(
      "kt-aaaaaa",
      "- [/] a #agent 🆔 kt-aaaaaa",
      4,
    );
  });
});

describe("noteLineOf", () => {
  /** A cache listing a top todo and its part in a.md, whose text embeds only the top one. */
  function cached() {
    const client = new QueryClient();
    const top = { id: "kt-aaaaaa", parent_id: null } as TodoRow;
    const part = { id: "kt-bbbbbb", parent_id: "kt-aaaaaa" } as TodoRow;
    client.setQueryData(
      ["todos", false],
      [
        { ...hit("- [ ] top 🆔 kt-aaaaaa", 1), todo: top },
        { ...hit("  - [ ] part 🆔 kt-bbbbbb", 2), todo: part },
      ],
    );
    client.setQueryData(["note", "a.md"], "# A\n\nprose\n![[kt-aaaaaa]] ^blk\n");
    return client;
  }

  it("answers the line that embeds a listed todo, and its parent's for a part", async () => {
    expect(await noteLineOf(cached(), "a.md", 1)).toBe(4);
    expect(await noteLineOf(cached(), "a.md", 2)).toBe(4);
  });

  it("leaves a line no todo is listed at", async () => {
    expect(await noteLineOf(cached(), "b.md", 7)).toBe(7);
  });
});
