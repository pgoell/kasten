import { act, renderHook } from "@testing-library/react";
import { dropText, heldText, holdText, resetHeld, sameText, useHeld } from "@/lib/held-text";

const entry = { content: "# left behind", reason: "failed with 500", conflicted: false };

describe("held text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem("kasten.held");
    resetHeld();
  });

  it("keeps held text across a reload of the page", () => {
    holdText("index.md", entry);
    // What a reload does to the module: the map in memory is gone, storage is not.
    resetHeld();

    expect(heldText("index.md")).toEqual(entry);
  });

  it("forgets a dropped note across a reload too", () => {
    holdText("index.md", entry);
    holdText("other.md", entry);
    dropText("index.md");
    resetHeld();

    expect(heldText("index.md")).toBeUndefined();
    expect(heldText("other.md")).toEqual(entry);
  });

  it("holds text in memory when storage refuses every touch", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    holdText("index.md", entry);

    expect(heldText("index.md")).toEqual(entry);
  });

  it("lists every held note, the same list until one changes", () => {
    const { result } = renderHook(() => useHeld());
    const before = result.current;

    act(() => holdText("index.md", entry));
    const after = result.current;

    expect(before).toEqual([]);
    expect(after).toEqual([{ path: "index.md", reason: "failed with 500" }]);
    expect(result.current).toBe(after);
  });

  it("reads two texts as one note when only the modified stamp differs", () => {
    const sent = "---\nid: 1\nmodified: 2026-10-14T10:00:00+00:00\n---\n# body";
    const landed = "---\nid: 1\nmodified: 2026-10-14T10:00:05+00:00\n---\n# body";

    expect(sameText(sent, landed)).toBe(true);
    expect(sameText(sent, `${landed} more`)).toBe(false);
    // A body line spelled like the stamp is the reader's, and counts.
    expect(sameText("# a\nmodified: x", "# a\nmodified: y")).toBe(false);
  });
});
