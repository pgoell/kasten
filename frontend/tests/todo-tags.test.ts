import { parsed } from "./todo-fixture";

describe("#617 a hash in a span or an address is no tag", () => {
  it("#617 A1 reads no tag in a code span", () => {
    expect(parsed("- [ ] run `grep #client log`").tags).toEqual([]);
  });

  it("#617 A2 reads no tag in a markdown link, its address or its label", () => {
    expect.soft(parsed("- [ ] [see](https://a.io/p#next)").tags).toEqual([]);
    expect(parsed("- [ ] [#next](x)").tags).toEqual([]);
  });

  it("#617 A3 reads no tag in a bare web address", () => {
    expect.soft(parsed("- [ ] see https://a.io/p#next").tags).toEqual([]);
    expect(parsed("- [ ] see https://a.io/#next").tags).toEqual([]);
  });

  it("#617 I1 still reads a real tag beside a span or an address", () => {
    expect.soft(parsed("- [ ] `grep x` #client").tags).toEqual(["#client"]);
    expect.soft(parsed("- [ ] see https://a.io #next").tags).toEqual(["#next"]);
    expect.soft(parsed("- [ ] run `grep #client log` #client").tags).toEqual(["#client"]);
    expect(parsed("- [ ] see https://a.io/p#top #next").tags).toEqual(["#next"]);
  });

  it("#617 I2 keeps the span and the address in the words byte for byte, only the tags change", () => {
    expect(parsed("- [ ] run `grep #client log` see https://a.io/p#next")).toMatchObject({
      text: "run `grep #client log` see https://a.io/p#next",
      tags: [],
    });
  });

  it("#617 I4 reads no tag in a wikilink anchor", () => {
    expect(parsed("- [ ] read [[note#p/x]]").tags).toEqual([]);
  });
});

describe("#627 a tag ends where the editor's tag ends", () => {
  it("#627 A1 a bracket, comma, stop, colon or bang after a tag ends it", () => {
    expect.soft(parsed("- [ ] see (#next)").tags).toEqual(["#next"]);
    expect.soft(parsed("- [ ] see #next, then").tags).toEqual(["#next"]);
    expect.soft(parsed("- [ ] see #next.").tags).toEqual(["#next"]);
    expect.soft(parsed("- [ ] see #next: now").tags).toEqual(["#next"]);
    expect(parsed("- [ ] see #next!").tags).toEqual(["#next"]);
  });

  // The backend's test_tags.py holds the same table, so the pane and the
  // endpoint agree on what a line is tagged.
  it.each([
    ["#123", []],
    ["note#2", []],
    ["https://a.io/p#x", []],
    ["#p/fde.", ["#p/fde"]],
    ["#café", ["#café"]],
    ["#a-b/c", ["#a-b/c"]],
    ["#x#y", ["#x"]],
  ])("#627 I1 reads the backend's tags off %s", (words, tags) => {
    expect(parsed(`- [ ] ${words}`).tags).toEqual(tags);
  });
});
