import { vim } from "@replit/codemirror-vim";
import { fireEvent, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { vaultPaths } from "@/lib/wikilink";
import { content, liveHooks, mount, plain, renderEditor } from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("colours a due date that has passed", () => {
    // Two dates nothing can reach, so the assertion holds on any day the suite
    // runs: one before every possible today and one after.
    const { container } = renderEditor(
      <Editor initialDoc={"- [ ] late 📅 1970-01-01\n- [ ] soon 📅 2999-01-01"} />,
    );

    const overdue = container.querySelectorAll(".cm-todo-overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.textContent).toBe("📅 1970-01-01");
  });

  it("colours a passed due date typed with the variation selector", () => {
    // Under a parent, so the tab nests the todo rather than opening a code block.
    const { container } = renderEditor(
      <Editor initialDoc={"- [ ] zork\n\t- [ ] call zork-qux 📅️ 1970-01-01 ^blk9"} />,
    );

    const overdue = container.querySelectorAll(".cm-todo-overdue");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.textContent).toBe("📅️ 1970-01-01");
  });

  /**
   * The red marks on `doc`, the cursor on an `intro` line above it so no todo
   * shows its source. Mounted bare rather than through `Editor`, so vim is on
   * or off for certain and not left to the stored setting.
   */
  function overdueIn(doc: string, vimOn: boolean): string[] {
    const view = mount(
      `intro\n\n${doc}`,
      vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null),
    );
    return [...view.contentDOM.querySelectorAll(".cm-todo-overdue")].map(
      (m) => m.textContent ?? "",
    );
  }

  const VIM = [
    ["vim on", true],
    ["vim off", false],
  ] as const;

  it.each(
    VIM.flatMap(([mode, vimOn]) => [
      ["📆", mode, vimOn],
      ["🗓", mode, vimOn],
    ]),
  )("reds a passed 📆 or 🗓 due: %s, %s", (glyph, _, vimOn) => {
    expect(overdueIn(`- [ ] zork ${glyph} 1970-01-01`, vimOn)).toEqual([`${glyph} 1970-01-01`]);
  });

  it.each(
    VIM.flatMap(([mode, vimOn]) => [
      ["📆️", mode, vimOn],
      ["🗓️", mode, vimOn],
    ]),
  )("reds a selector-typed passed due: %s, %s", (glyph, _, vimOn) => {
    expect(overdueIn(`- [ ] zork ${glyph} 1970-01-01`, vimOn)).toEqual([`${glyph} 1970-01-01`]);
  });

  it.each(VIM)("leaves a due inside a code span uncoloured, %s", (_, vimOn) => {
    expect(overdueIn("- [ ] zork `📅 1970-01-01`", vimOn)).toEqual([]);
  });

  it("leaves a todo inside a fence uncoloured", () => {
    expect(overdueIn("```\n- [ ] zork 📅 1970-01-01\n```", false)).toEqual([]);
  });

  it("reds the due after a code span holding one, the span's not", () => {
    expect(overdueIn("- [ ] zork `📅 1970-01-01` 📅 1970-01-02", false)).toEqual(["📅 1970-01-02"]);
  });

  it.each([
    ["wikilink", "- [ ] zork [[note 📅 1970-01-01]]"],
    ["markdown link", "- [ ] zork [a 📅 1970-01-01](x)"],
  ])("leaves a due inside a %s uncoloured", (_, doc) => {
    expect(overdueIn(doc, false)).toEqual([]);
  });

  it.each([["📆"], ["🗓"]])("leaves a future %s due uncoloured", (glyph) => {
    expect(overdueIn(`- [ ] zork ${glyph} 2999-01-01`, false)).toEqual([]);
  });

  it("keeps the overdue colour on the line being edited", async () => {
    // Unlike the symbol, the red stands in for nothing: it is colour on text
    // that is on the screen whether the line shows its source or not.
    const { container } = renderEditor(<Editor initialDoc={"- [ ] late 📅 1970-01-01"} />);

    fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: "i" });

    await waitFor(() => expect(content(container)).toContain("- [ ] "));
    expect(container.querySelectorAll(".cm-todo-overdue")).toHaveLength(1);
  });
});
