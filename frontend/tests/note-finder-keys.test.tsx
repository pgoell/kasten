import { PATHS, renderFinder } from "./note-finder-fixture";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is which note it
// asks for and how often, not the HTTP.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

describe("the note finder", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  it("moves the highlight down with the arrow and with ctrl n", () => {
    const finder = renderFinder();

    expect(finder.highlighted()).toBe(PATHS[0]);
    finder.press("ArrowDown");
    expect(finder.highlighted()).toBe(PATHS[1]);
    finder.press("n", { ctrlKey: true });
    expect(finder.highlighted()).toBe(PATHS[2]);
  });

  it("moves the highlight down with ctrl j and back up with ctrl k", () => {
    const finder = renderFinder();

    finder.press("j", { ctrlKey: true });
    expect.soft(finder.highlighted()).toBe(PATHS[1]);
    finder.press("k", { ctrlKey: true });
    finder.press("k", { ctrlKey: true });
    finder.press("j", { ctrlKey: true });
    expect(finder.highlighted()).toBe(PATHS[1]);
  });

  it("moves the highlight up with the arrow and with ctrl p", () => {
    const finder = renderFinder();

    finder.press("ArrowDown");
    finder.press("ArrowDown");
    expect(finder.highlighted()).toBe(PATHS[2]);
    finder.press("ArrowUp");
    expect(finder.highlighted()).toBe(PATHS[1]);
    finder.press("p", { ctrlKey: true });
    expect(finder.highlighted()).toBe(PATHS[0]);
  });

  it("opens the highlighted note, not the text that was typed", () => {
    // The whole contract of the finder against the prompt's. `kap` names no
    // path at all; the row it ranks first does.
    const finder = renderFinder();

    finder.type("kap");
    finder.press("Enter");

    expect(finder.onOpen).toHaveBeenCalledWith("projects/kasten/api-design.md");
  });

  it("opens the row the highlight was moved to", () => {
    const finder = renderFinder();

    finder.press("ArrowDown");
    finder.press("Enter");

    expect(finder.onOpen).toHaveBeenCalledWith(PATHS[1]);
  });

  it("closes on escape without opening anything", () => {
    const finder = renderFinder();

    finder.press("Escape");

    expect(finder.onClose).toHaveBeenCalledTimes(1);
    expect(finder.onOpen).not.toHaveBeenCalled();
  });

  it("puts the highlight back on the first row when the query changes", () => {
    const finder = renderFinder();

    finder.press("ArrowDown");
    finder.type("k");

    expect(finder.highlighted()).toBe("projects/kasten.md");
  });

  it("walks the list on tab rather than letting the focus leave", () => {
    const finder = renderFinder();

    expect(finder.press("Tab")).toBe(false);

    expect(finder.highlighted()).toBe("index.md");
  });

  it("walks back up on shift tab", () => {
    const finder = renderFinder();

    finder.press("Tab");
    finder.press("Tab", { shiftKey: true });

    expect(finder.highlighted()).toBe("daily/2026-08-05.md");
  });

  it("holds the focus on tab even with nothing to walk", () => {
    // An empty list is the one place Tab would leave the panel and not come
    // back, so the key is answered before the list is looked at.
    const finder = renderFinder([]);

    expect(finder.press("Tab")).toBe(false);
  });
});
