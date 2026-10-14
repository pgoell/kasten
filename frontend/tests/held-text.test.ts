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

  it("keeps another tab's held text when holding one of its own", () => {
    holdText("index.md", entry);
    // Another tab holds a note of its own, straight into storage.
    localStorage.setItem(
      "kasten.held",
      JSON.stringify({ "index.md": entry, "other.md": { ...entry, content: "# theirs" } }),
    );

    holdText("daily.md", entry);
    dropText("index.md");
    resetHeld();

    expect(heldText("other.md")?.content).toBe("# theirs");
    expect(heldText("daily.md")).toEqual(entry);
    expect(heldText("index.md")).toBeUndefined();
  });

  it("follows another tab's held text in the list", () => {
    const { result } = renderHook(() => useHeld());

    act(() => {
      localStorage.setItem("kasten.held", JSON.stringify({ "other.md": entry }));
      window.dispatchEvent(new StorageEvent("storage", { key: "kasten.held" }));
    });

    expect(result.current).toEqual([
      { path: "other.md", reason: "failed with 500", conflicted: false },
    ]);
  });

  it("lists whether each held note stands conflicted", () => {
    const { result } = renderHook(() => useHeld());

    act(() => {
      holdText("a.md", entry);
      holdText("b.md", { ...entry, reason: "Changed on disk", conflicted: true });
    });

    expect(result.current).toEqual([
      { path: "a.md", reason: "failed with 500", conflicted: false },
      { path: "b.md", reason: "Changed on disk", conflicted: true },
    ]);
  });

  it("keeps text held in memory when storage was full, through a hold of another note", () => {
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    holdText("index.md", entry);
    full.mockRestore();

    holdText("other.md", entry);

    expect(heldText("index.md")).toEqual(entry);
    // Written out with the next write that storage takes.
    resetHeld();
    expect(heldText("index.md")).toEqual(entry);
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
    expect(after).toEqual([{ path: "index.md", reason: "failed with 500", conflicted: false }]);
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
