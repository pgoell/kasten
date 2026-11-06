import { QueryClient } from "@tanstack/react-query";
import { ChangedOnDisk } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import { retryHeld } from "@/lib/saving/held-retry";
import { type Held, heldTexts, holdText, resetHeld } from "@/lib/saving/held-text";

const { saveNote } = vi.hoisted(() => ({ saveNote: vi.fn() }));
vi.mock("@/lib/core/api", async (importOriginal) => ({
  saveNote,
  ChangedOnDisk: (await importOriginal<typeof import("@/lib/core/api")>()).ChangedOnDisk,
}));

/** The page's pass over held text a lost signal left, for notes no editor holds. */
describe("retryHeld", () => {
  const lost: Held = {
    content: "typed",
    reason: "Failed to fetch",
    conflicted: false,
    base: "old",
  };
  let client: QueryClient;
  const write = <T>(_note: string, work: () => Promise<T>) => work();
  const pass = (skip: (path: string) => boolean = () => false) =>
    retryHeld({ write, skip, queryClient: client });

  beforeEach(() => {
    client = new QueryClient();
    saveNote.mockImplementation(async (path: string, content: string) => ({
      path,
      content: `${content}\nmodified: now`,
    }));
  });

  afterEach(() => {
    saveNote.mockReset();
    localStorage.removeItem("kasten.held.2");
    resetHeld();
  });

  it("writes held text under the base it was typed on, and lets it go once it lands", async () => {
    holdText("a.md", lost);

    await pass();

    expect(saveNote).toHaveBeenCalledWith("a.md", "typed", false, noteBase("old"));
    expect(heldTexts("a.md")).toEqual([]);
    expect(client.getQueryData(["note", "a.md"])).toBe("typed\nmodified: now");
  });

  it("marks the text conflicted when somebody wrote the note since", async () => {
    holdText("a.md", lost);
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());

    await pass();

    expect(heldTexts("a.md")).toEqual([{ ...lost, conflicted: true }]);
  });

  it("marks the text refused when the vault turns it away for good", async () => {
    holdText("a.md", lost);
    saveNote.mockRejectedValueOnce(new Error("failed with 422", { cause: 422 }));

    await pass();
    await pass();

    expect(heldTexts("a.md")).toEqual([{ ...lost, refused: true }]);
    expect(saveNote).toHaveBeenCalledOnce();
  });

  it.each([
    ["no signal", new TypeError("Failed to fetch")],
    ["a 5xx", new Error("failed with 503", { cause: 503 })],
  ])("keeps the text for the next pass after %s", async (_name, failure) => {
    holdText("a.md", lost);
    saveNote.mockRejectedValueOnce(failure);

    await pass();

    expect(heldTexts("a.md")).toEqual([lost]);
  });

  it.each<[string, Held]>([
    ["conflicted", { ...lost, conflicted: true }],
    ["refused", { ...lost, refused: true }],
    ["kept with no base", { content: "typed", reason: "x", conflicted: false }],
    ["typed on a write in the air", { ...lost, after: "sent" }],
  ])("leaves text %s alone", async (_name, entry) => {
    holdText("a.md", entry);

    await pass();

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("leaves a note holding two texts alone, since writing one makes the other stale", async () => {
    holdText("a.md", lost);
    holdText("a.md", { ...lost, content: "typed later" });

    await pass();

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("leaves a note the page says to skip, such as the one being typed in", async () => {
    holdText("a.md", lost);

    await pass((path) => path === "a.md");

    expect(saveNote).not.toHaveBeenCalled();
  });
});
