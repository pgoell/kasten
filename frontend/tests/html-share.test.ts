import { shareLine, sourceOf, storyOf } from "@/lib/html/html-share";

const PAGE = "01 Periodic/05 Newspaper/2026-10-26.html";
const DAILY = "01 Periodic/00 Daily/2026-10-26.md";

describe("shareLine", () => {
  it("links the headline to its source and the paper beside it", () => {
    const story = { heading: "First story", anchor: "s1", source: "https://news.example/one" };
    expect(shareLine(PAGE, story, DAILY, "2026-10-26")).toBe(
      `- [ ] share [First story](https://news.example/one) ([[${PAGE}#s1|in the paper]]) #share ➕ 2026-10-26`,
    );
  });

  it("links the headline to the paper where the story names no source", () => {
    const story = { heading: "First story", anchor: "s1", source: "" };
    expect(shareLine(PAGE, story, DAILY, "2026-10-26")).toBe(
      `- [ ] share [[${PAGE}#s1|First story]] #share ➕ 2026-10-26`,
    );
  });

  it("takes the link and tag syntax out of a headline", () => {
    const story = { heading: "A [b] #c | d", anchor: "s1", source: "https://x.example/" };
    expect(shareLine(PAGE, story, DAILY, "2026-10-26")).toContain(
      "share [A b c d](https://x.example/)",
    );
  });

  it("names the page where the story has no headline", () => {
    const story = { heading: "", anchor: "s1", source: "" };
    expect(shareLine(PAGE, story, DAILY, "2026-10-26")).toContain("|2026-10-26.html]]");
  });
});

describe("sourceOf", () => {
  it("keeps an http or https address", () => {
    expect(sourceOf("https://news.example/a?b=1")).toBe("https://news.example/a?b=1");
    expect(sourceOf("http://news.example/")).toBe("http://news.example/");
  });

  it("drops any other scheme, and what is no address", () => {
    expect(sourceOf("javascript:alert(1)")).toBe("");
    expect(sourceOf("data:text/html,x")).toBe("");
    expect(sourceOf("not a link")).toBe("");
    expect(sourceOf("")).toBe("");
  });

  it("encodes what would end the markdown link early", () => {
    expect(sourceOf("https://x.example/a (b)")).toBe("https://x.example/a%20%28b%29");
  });

  it("drops an address too long to keep whole", () => {
    expect(sourceOf(`https://x.example/${"a".repeat(3000)}`)).toBe("");
  });
});

describe("storyOf", () => {
  it("reads a share message", () => {
    expect(storyOf({ heading: "H", anchor: "s1", source: "ftp://x" })).toEqual({
      heading: "H",
      anchor: "s1",
      source: "",
    });
  });

  it("refuses a message with a field missing or no story id", () => {
    expect(storyOf({ heading: "H", anchor: "s1" })).toBeNull();
    expect(storyOf({ heading: "H", anchor: "", source: "" })).toBeNull();
  });
});
