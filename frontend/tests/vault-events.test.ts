import { parseVaultEvent } from "@/lib/vault-events";

describe("parseVaultEvent", () => {
  it("reads a note that was written", () => {
    expect(
      parseVaultEvent('{"path": "notes/a.md", "change": "written", "digest": "abc123"}'),
    ).toEqual({ path: "notes/a.md", change: "written", digest: "abc123" });
  });

  it("reads a note that is gone", () => {
    expect(parseVaultEvent('{"path": "notes/a.md", "change": "removed", "digest": null}')).toEqual({
      path: "notes/a.md",
      change: "removed",
      digest: null,
    });
  });

  it("reads a listing, which names no note", () => {
    expect(parseVaultEvent('{"path": "", "change": "listing", "digest": null}')).toEqual({
      path: "",
      change: "listing",
      digest: null,
    });
  });

  it("refuses a kind it does not know", () => {
    // A newer backend saying something this build has no answer for. Quiet is
    // the right answer: the client acts on the kinds it understands and lets
    // the rest go by.
    expect(
      parseVaultEvent('{"path": "notes/a.md", "change": "renamed", "digest": null}'),
    ).toBeNull();
  });

  it("refuses a payload that is not JSON", () => {
    expect(parseVaultEvent("not json at all")).toBeNull();
  });

  // Valid JSON that is no event, `null` first: it is the shape that throws
  // rather than merely failing a test, so the guard it needs is the one a
  // later reader would otherwise take for dead weight.
  it.each([["null"], ["42"], ['"str"'], ["[]"], ["{}"]])("refuses the payload %s", (data) => {
    expect(parseVaultEvent(data)).toBeNull();
  });

  it("refuses a path that is not a string", () => {
    expect(parseVaultEvent('{"path": 7, "change": "written", "digest": null}')).toBeNull();
  });

  it("refuses a digest that is neither a string nor null", () => {
    expect(parseVaultEvent('{"path": "notes/a.md", "change": "written", "digest": 7}')).toBeNull();
  });
});
