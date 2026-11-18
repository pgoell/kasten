import { fireEvent } from "@testing-library/react";
import type { TodoRow } from "@/lib/core/api";
import { ABOVE, fakeVault, liveHooks, mount, plain } from "./live-preview-fixture";

liveHooks();

/** The vault's source, with a todo listing that answers `rows` and records each cycle. */
function withTodos(rows: Record<string, Partial<TodoRow>>) {
  const { source, watched } = fakeVault({});
  const cycled: string[] = [];
  source.watchTodo = (id, listener) => {
    listener((rows[id] as TodoRow | undefined) ?? null);
    return () => {};
  };
  source.cycleTodo = (id) => cycled.push(id);
  return { source, watched, cycled };
}

describe("#2191 a todo embed", () => {
  it("draws the store todo's box and words, and reads no note named after it", () => {
    const todos = withTodos({
      "kt-1a2b3c": { words: "send the deck", state: "doing", done: null },
    });
    const view = mount(`${ABOVE}![[kt-1a2b3c]]`, plain(todos.source));

    const box = view.dom.querySelector(".cm-todo-embed");
    expect(box?.textContent).toBe("◐ send the deck");
    expect(view.dom.querySelector(".cm-embed-missing")).toBeNull();
    expect(todos.watched).toEqual([]);
  });

  it("walks the todo on from a press on its box", () => {
    const todos = withTodos({ "kt-1a2b3c": { words: "a", state: "open", done: null } });
    const view = mount(`${ABOVE}![[kt-1a2b3c]]`, plain(todos.source));

    fireEvent.mouseDown(view.dom.querySelector(".cm-todo-embed-box") as HTMLElement);
    expect(todos.cycled).toEqual(["kt-1a2b3c"]);
  });

  it("draws a todo the list does not hold as its id, not as a missing note", () => {
    const todos = withTodos({});
    const view = mount(`${ABOVE}![[kt-ffffff]]`, plain(todos.source));

    expect(view.dom.querySelector(".cm-todo-embed-gone")?.textContent).toBe("☐ kt-ffffff");
    expect(view.dom.querySelector(".cm-embed-missing")).toBeNull();
  });
});
