import { act, renderHook } from "@testing-library/react";
import {
  dropText,
  heldText,
  holdText,
  landedAs,
  moveHeld,
  resetHeld,
  sameText,
  useHeld,
} from "@/lib/held-text";

const entry = { content: "# left behind", reason: "failed with 500", conflicted: false };

describe("held text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem("kasten.held");
    localStorage.removeItem("kasten.held.2");
    resetHeld();
  });

  it("keeps two texts held for one note, and lists both", () => {
    const { result } = renderHook(() => useHeld());
    const second = { ...entry, content: "# typed later" };

    act(() => {
      holdText("index.md", entry);
      holdText("index.md", second);
    });

    expect(result.current).toHaveLength(2);
    // The oldest is the one offered.
    expect(heldText("index.md")).toEqual(entry);
  });

  it("holds one entry for two holds of the same text", () => {
    const { result } = renderHook(() => useHeld());

    act(() => {
      holdText("index.md", entry);
      holdText("index.md", { ...entry, reason: "failed with 502" });
    });

    expect(result.current).toHaveLength(1);
    expect(heldText("index.md")?.reason).toBe("failed with 502");
  });

  it("offers text the old build held, and moves it to the new key", () => {
    localStorage.setItem("kasten.held", JSON.stringify({ "index.md": entry }));

    expect(heldText("index.md")).toEqual(entry);
    holdText("other.md", entry);

    expect(localStorage.getItem("kasten.held")).toBeNull();
    resetHeld();
    expect(heldText("index.md")).toEqual(entry);
    expect(heldText("other.md")).toEqual(entry);
  });

  it("keeps text another tab held for a note when this tab holds text for it", () => {
    const theirs = { ...entry, content: "# theirs" };
    const { result } = renderHook(() => useHeld());

    act(() => {
      // A tab of the old build, still open after the deploy.
      localStorage.setItem("kasten.held", JSON.stringify({ "index.md": theirs }));
      window.dispatchEvent(new StorageEvent("storage", { key: "kasten.held" }));
    });
    act(() => holdText("index.md", entry));
    resetHeld();

    expect(result.current).toHaveLength(2);
    expect(heldText("index.md")).toEqual(theirs);
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

  it("keeps the texts another tab of this build held, list and all", () => {
    const theirs = { ...entry, content: "# theirs" };
    const { result } = renderHook(() => useHeld());
    act(() => holdText("index.md", entry));

    act(() => {
      localStorage.setItem(
        "kasten.held.2",
        JSON.stringify({ "index.md": [entry], "other.md": [theirs, entry] }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: "kasten.held.2" }));
    });
    act(() => holdText("daily.md", entry));
    resetHeld();

    expect(result.current).toHaveLength(4);
    expect(heldText("other.md")).toEqual(theirs);
  });

  it("follows another tab's held text in the list", () => {
    const { result } = renderHook(() => useHeld());

    act(() => {
      localStorage.setItem("kasten.held", JSON.stringify({ "other.md": entry }));
      window.dispatchEvent(new StorageEvent("storage", { key: "kasten.held" }));
    });

    expect(result.current).toEqual([
      { path: "other.md", reason: "failed with 500", conflicted: false, entry },
    ]);
  });

  it("moves held text to the note's new path", () => {
    holdText("Inbox/a.md", entry);
    holdText("Other/b.md", entry);

    moveHeld((path) => (path.startsWith("Inbox/") ? `Done/${path.slice(6)}` : undefined));
    resetHeld();

    expect(heldText("Done/a.md")).toEqual(entry);
    expect(heldText("Inbox/a.md")).toBeUndefined();
    expect(heldText("Other/b.md")).toEqual(entry);
  });

  it("carries held text onto a path that already holds some, keeping both", () => {
    const theirs = { ...entry, content: "# already held there" };
    const { result } = renderHook(() => useHeld());
    act(() => {
      holdText("a.md", entry);
      holdText("b.md", theirs);
    });

    act(() => moveHeld((path) => (path === "a.md" ? "b.md" : undefined)));

    expect(heldText("a.md")).toBeUndefined();
    expect(heldText("b.md")).toEqual(theirs);
    expect(result.current.map(({ path }) => path)).toEqual(["b.md", "b.md"]);
  });

  it("lists whether each held note stands conflicted", () => {
    const { result } = renderHook(() => useHeld());
    const conflict = { ...entry, reason: "Changed on disk", conflicted: true };

    act(() => {
      holdText("a.md", entry);
      holdText("b.md", conflict);
    });

    expect(result.current).toEqual([
      { path: "a.md", reason: "failed with 500", conflicted: false, entry },
      { path: "b.md", reason: "Changed on disk", conflicted: true, entry: conflict },
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
    expect(after).toEqual([
      { path: "index.md", reason: "failed with 500", conflicted: false, entry },
    ]);
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

  it("reads held text as landed when the vault gave it the block its write stamps", () => {
    // A keepalive of a note with no block, landed after the page was gone.
    const vault =
      "---\nid: 0199\ncreated: 2026-10-14T10:00:00+00:00\ntype: Note\nmodified: 2026-10-14T10:00:00+00:00\n---\n# held";

    expect(landedAs("# held", vault)).toBe(true);
    expect(
      landedAs("---\ntype: Book\n---\n# held", vault.replace("type: Note", "type: Book")),
    ).toBe(true);
    expect(landedAs("# held more", vault)).toBe(false);
  });

  it("does not read held text as landed when the vault differs in a line the held copy set", () => {
    // `stamp` never argues with a type already there, so a different one is
    // somebody else's, or the held edit never landed.
    const held = "---\nid: 0199\ntype: Book\n---\n# held";

    expect(landedAs(held, "---\nid: 0199\ntype: Note\nmodified: now\n---\n# held")).toBe(false);
    expect(landedAs(held, "---\nid: 0199\ntype: Book\nstatus: done\n---\n# held")).toBe(false);
  });
});
