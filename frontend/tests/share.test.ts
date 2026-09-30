import { firstAddress, sharedDraft } from "@/lib/share";

describe("sharedDraft", () => {
  it("puts each field that says something on a line of its own", () => {
    expect(sharedDraft({ title: "A post", text: "worth reading", url: "https://a.b/c" })).toBe(
      "A post\nworth reading\nhttps://a.b/c",
    );
  });

  it("does not repeat an address the text already holds", () => {
    // Chrome sharing a page sends the address in `text` and in `url` both.
    expect(sharedDraft({ title: "A post", text: "https://a.b/c", url: "https://a.b/c" })).toBe(
      "A post\nhttps://a.b/c",
    );
  });

  it("is empty for a page opened without a share", () => {
    expect(sharedDraft({})).toBe("");
  });
});

describe("firstAddress", () => {
  it("finds the address inside a line of prose", () => {
    expect(firstAddress("read this https://a.b/c?d=1 later")).toBe("https://a.b/c?d=1");
  });

  it("answers with nothing where there is no web address", () => {
    expect(firstAddress("call Jonas about ftp://x")).toBeNull();
  });
});
