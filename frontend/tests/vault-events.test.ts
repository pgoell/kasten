import { digestOf, parseVaultEvent } from "@/lib/vault-events";

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

describe("digestOf", () => {
  // The hex Python's `hexdigest()` prints for the same input, which is what the
  // backend puts on the wire. Both sides have to spell it identically or a
  // write of our own reads as somebody else's.
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["hello", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"],
    // The backend hashes the bytes on disk, so a note holding anything but
    // ASCII only agrees if this side hashes UTF-8 too.
    ["Grüße vom Vault\n", "e3c180b9c84038b150509a5639e4452326e61e1c3a2277913263f3899e7d2d33"],
  ])("hashes %j the way the backend does", async (text, hex) => {
    await expect(digestOf(text)).resolves.toBe(hex);
  });
});
