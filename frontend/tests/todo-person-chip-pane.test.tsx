import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodoPane } from "@/components/todo-pane";
import type { SearchHit } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import { DEFAULT_VIEWS, VIEWS_NOTE } from "@/lib/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { paneHooks } from "./todo-pane-fixture";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();

// Today is the day the waiting row below was written, so its `5d` is the one the test reads.
const TODAY = "2026-10-25";
const DAILY = "01 Periodic/00 Daily/2026-10-25.md";
const PASCAL = "03 Areas/08 People/Pascal.md";
const ALICIA = "03 Areas/08 People/Alicia.md";

const HITS: SearchHit[] = [
  { path: DAILY, line: 1, text: "- [ ] a 👤 [[Pascal]]" },
  { path: DAILY, line: 2, text: "- [/] b 👤 [[Alicia]]" },
  { path: DAILY, line: 3, text: "- [w] c 👤 [[Pascal]] 👤 2026-10-20 [[Alicia]]" },
];

/** The pane over `hits`, drawn the way the pane is drawn in the app, with today pinned. */
function renderPane(hits: SearchHit[] = HITS) {
  vi.mocked(fetchTodos).mockResolvedValue(hits);
  const onOpen = vi.fn();
  const onCycle = vi.fn();
  const onBlock = vi.fn();
  const client = new QueryClient();

  render(
    <QueryClientProvider client={client}>
      <TodoPane
        commands={{} as EditorCommands}
        onOpen={onOpen}
        onCycle={onCycle}
        onAdd={vi.fn()}
        onSubtask={vi.fn()}
        onEdit={vi.fn()}
        onBlock={onBlock}
        onTimer={vi.fn()}
        onAgent={vi.fn()}
        onRefile={vi.fn()}
        onNotice={vi.fn()}
        focusSignal={0}
        today={TODAY}
      />
    </QueryClientProvider>,
  );

  return { onOpen, onCycle, onBlock };
}

/** The row of a daily-note line, which is drawn with its path and line as its key. */
function rowAt(line: number): HTMLElement {
  return document.querySelector(`[data-row="${DAILY}:${line}"]`) as HTMLElement;
}

/** The chip on a row, which the row must hold. */
function chipOf(line: number): HTMLElement {
  const chip = rowAt(line).querySelector<HTMLElement>("[data-person]");
  expect(chip).not.toBeNull();
  return chip as HTMLElement;
}

/** The two person notes, each `type: Person`, which the vault holds beside the views note. */
const PEOPLE: Record<string, string> = {
  [PASCAL]: "---\ntype: Person\n---\n\n# Pascal\n",
  [ALICIA]: "---\ntype: Person\n---\n\n# Alicia\n",
};

describe("the assignee chip on a todo row", () => {
  beforeEach(() => {
    vi.mocked(fetchFiles).mockResolvedValue([VIEWS_NOTE, PASCAL, ALICIA]);
    vi.mocked(fetchNote).mockImplementation(async (path: string) => PEOPLE[path] ?? DEFAULT_VIEWS);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("#809 A4 the todo pane draws the assignee as a chip on open, doing and waiting rows", async () => {
    renderPane();
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());

    expect(chipOf(1).textContent).toBe("Pascal");
    expect(chipOf(2).textContent).toBe("Alicia");
    expect(chipOf(3).textContent).toBe("Pascal");
    expect(rowAt(3).textContent).toContain("👤 5d Alicia");
  });

  it("#809 A4 a click on the chip opens the person note, a click on the row opens the todo's note", async () => {
    const { onOpen } = renderPane();
    await waitFor(() => expect(chipOf(1)).toHaveAttribute("data-person-path", PASCAL));

    fireEvent.click(chipOf(1));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(PASCAL, 1);

    fireEvent.click(rowAt(1));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith(DAILY, 1);
  });

  it("#809 A4 a tap on the chip on a phone opens the person note and arms no state button", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const { onOpen, onCycle } = renderPane();
    await waitFor(() => expect(chipOf(1)).toHaveAttribute("data-person-path", PASCAL));

    fireEvent.click(chipOf(1));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith(PASCAL, 1);
    expect(onCycle).not.toHaveBeenCalled();
    expect(screen.getByLabelText("cycle a").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("more for a").getAttribute("aria-expanded")).toBe("false");
  });

  it("#809 I3 a path and an alias open the same person note and the chip shows the alias", async () => {
    const { onOpen } = renderPane([
      { path: DAILY, line: 1, text: "- [ ] d 👤 [[03 Areas/08 People/Pascal]]" },
      { path: DAILY, line: 2, text: "- [ ] e 👤 [[Pascal|P]]" },
    ]);
    await waitFor(() => expect(chipOf(1)).toHaveAttribute("data-person-path", PASCAL));

    expect(chipOf(1).textContent).toBe("Pascal");
    expect(chipOf(2).textContent).toBe("P");
    expect(chipOf(2)).toHaveAttribute("data-person-path", PASCAL);
    fireEvent.click(chipOf(1));
    fireEvent.click(chipOf(2));
    expect(onOpen).toHaveBeenNthCalledWith(1, PASCAL, 1);
    expect(onOpen).toHaveBeenNthCalledWith(2, PASCAL, 1);
  });

  it("#809 A4 an assignee with no note is an unlinked chip and a click on it opens the todo's note", async () => {
    const { onOpen } = renderPane([
      { path: DAILY, line: 1, text: "- [ ] f 👤 [[Nobody]]" },
      { path: DAILY, line: 2, text: "- [ ] g 👤 Alicia" },
    ]);
    await waitFor(() => expect(chipOf(1)).not.toBeNull());

    expect(chipOf(1).textContent).toBe("Nobody");
    expect(chipOf(2).textContent).toBe("Alicia");
    expect(chipOf(1).hasAttribute("data-person-path")).toBe(false);
    expect(chipOf(2).hasAttribute("data-person-path")).toBe(false);
    fireEvent.click(chipOf(1));
    fireEvent.click(chipOf(2));
    expect(onOpen).toHaveBeenNthCalledWith(1, DAILY, 1);
    expect(onOpen).toHaveBeenNthCalledWith(2, DAILY, 2);
  });

  it("#809 I2 a click on a chip while picking a blocker picks the row", async () => {
    const { onOpen, onBlock } = renderPane();
    await waitFor(() => expect(chipOf(2)).toHaveAttribute("data-person-path", ALICIA));

    // `b` on the first row, then a click on the chip of the second: the chip is that row.
    fireEvent.keyDown(screen.getByRole("region", { name: "Todos" }), { key: "b" });
    fireEvent.click(chipOf(2));

    expect(onBlock).toHaveBeenCalledExactlyOnceWith(HITS[0], HITS[1]);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
