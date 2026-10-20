import { PATHS, renderPrompt } from "./note-prompt-fixture";

const { createNote, renameNote, moveFolder } = vi.hoisted(() => ({
  createNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ createNote }));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));

describe("the new note prompt", () => {
  beforeEach(() => {
    createNote.mockResolvedValue({ path: "daily/note.md", content: "" });
  });

  afterEach(() => {
    createNote.mockReset();
  });

  it("moves the highlight down and up on the arrows", () => {
    const prompt = renderPrompt();

    expect(prompt.highlighted()).toBe("daily/");

    prompt.press("ArrowDown");
    expect(prompt.highlighted()).toBe("projects/");

    prompt.press("ArrowUp");
    expect(prompt.highlighted()).toBe("daily/");
  });

  it("moves the highlight on ctrl+n and ctrl+p too", () => {
    const prompt = renderPrompt();

    prompt.press("n", { ctrlKey: true });
    expect(prompt.highlighted()).toBe("projects/");

    prompt.press("p", { ctrlKey: true });
    expect(prompt.highlighted()).toBe("daily/");
  });

  it("stops the highlight at the ends of the list", () => {
    const prompt = renderPrompt();

    prompt.press("ArrowUp");
    expect(prompt.highlighted()).toBe("daily/");

    prompt.press("ArrowDown");
    prompt.press("ArrowDown");
    prompt.press("ArrowDown");
    expect(prompt.highlighted()).toBe("projects/kasten/");
  });

  it("keeps the arrows off the caret", () => {
    // Left to the browser they take the caret to one end of the input instead.
    const prompt = renderPrompt();

    expect(prompt.press("ArrowDown")).toBe(false);
    expect(prompt.press("ArrowUp")).toBe(false);
  });

  it("keeps the highlight in the list when a fresh listing shortens it", () => {
    // Typing cannot strand the highlight, because it puts it back on the first
    // row. A listing arriving from the tree can.
    const prompt = renderPrompt();

    prompt.press("ArrowDown");
    prompt.press("ArrowDown");
    expect(prompt.highlighted()).toBe("projects/kasten/");

    prompt.setPaths(["daily/2026-08-05.md"]);

    expect(prompt.highlighted()).toBe("daily/");
  });

  it("leaves the highlight where it is when a fresh listing lengthens it", () => {
    const prompt = renderPrompt();

    prompt.press("ArrowDown");
    prompt.press("ArrowDown");
    prompt.press("ArrowDown");

    prompt.setPaths([...PATHS, "reading/borges.md"]);

    // The fourth row is one the highlight never walked to.
    expect(prompt.highlighted()).toBe("projects/kasten/");
  });
});
