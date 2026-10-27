import { readPosition, writePosition } from "@/lib/editor/positions";

const KEY = "kasten.positions.1";

describe("the cursor and scroll store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("positions: A6 a written position reads back for its path and no other", () => {
    writePosition("a.md", { anchor: 3, head: 5, top: 120 });

    expect(readPosition("a.md")).toEqual({ anchor: 3, head: 5, top: 120 });
    expect(readPosition("b.md")).toBeUndefined();
  });

  it("positions: A6 the store holds a path and three numbers, never note text", () => {
    writePosition("notes/a.md", { anchor: 3, head: 5, top: 120 });

    expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual([
      ["notes/a.md", { anchor: 3, head: 5, top: 120 }],
    ]);
  });

  it("positions: A6 keeps the 200 most recently written paths", () => {
    for (let i = 0; i < 200; i += 1) writePosition(`${i}`, { anchor: i, head: i, top: 0 });
    // Written again, so the oldest is now the second one written.
    writePosition("0", { anchor: 7, head: 7, top: 0 });
    writePosition("200", { anchor: 200, head: 200, top: 0 });

    expect(readPosition("0")).toEqual({ anchor: 7, head: 7, top: 0 });
    expect(readPosition("1")).toBeUndefined();
    expect(readPosition("2")).toEqual({ anchor: 2, head: 2, top: 0 });
    expect(readPosition("200")).toEqual({ anchor: 200, head: 200, top: 0 });
  });

  it.each([
    ["not json", "{not json"],
    ["an object", '{"a.md":{"anchor":1,"head":1,"top":0}}'],
    ["an entry missing a number", '[["a.md",{"anchor":1,"head":1}]]'],
  ])("positions: A6 a stored value that is %s reads as empty and is removed", (_, raw) => {
    localStorage.setItem(KEY, raw);

    expect(readPosition("a.md")).toBeUndefined();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("positions: A6 blocked storage reads as nothing and a write goes nowhere", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);

    expect(() => writePosition("a.md", { anchor: 1, head: 1, top: 0 })).not.toThrow();
    expect(readPosition("a.md")).toBeUndefined();
  });

  it("positions: A6 full storage drops the write and what was stored stays", () => {
    writePosition("a.md", { anchor: 1, head: 1, top: 0 });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() => writePosition("b.md", { anchor: 2, head: 2, top: 0 })).not.toThrow();
    expect(readPosition("a.md")).toEqual({ anchor: 1, head: 1, top: 0 });
    expect(readPosition("b.md")).toBeUndefined();
  });

  it("positions: A6 another tab's write counts on the next read and the last write wins", () => {
    writePosition("a.md", { anchor: 1, head: 1, top: 0 });
    // Another tab, writing the same key after this one did.
    localStorage.setItem(
      KEY,
      JSON.stringify([
        ["a.md", { anchor: 9, head: 9, top: 40 }],
        ["b.md", { anchor: 2, head: 2, top: 0 }],
      ]),
    );

    expect(readPosition("a.md")).toEqual({ anchor: 9, head: 9, top: 40 });
    writePosition("c.md", { anchor: 3, head: 3, top: 0 });
    expect(readPosition("b.md")).toEqual({ anchor: 2, head: 2, top: 0 });
  });
});
