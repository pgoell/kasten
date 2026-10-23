import { readGraphMode, writeGraphMode } from "@/lib/graph-mode";

// Order matters: a refused write holds its pick for the page until the next
// write that storage takes, so the refusal runs last.
describe("graph mode", () => {
  beforeEach(() => localStorage.clear());

  afterEach(() => vi.restoreAllMocks());

  it("I6 a stray stored mode reads as Folders", () => {
    localStorage.setItem("kasten.graph.mode", "bogus");

    expect(readGraphMode()).toBe("folders");
  });

  it("I6 a pick still applies when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() => writeGraphMode("tags")).not.toThrow();
    expect(readGraphMode()).toBe("tags");
  });
});
