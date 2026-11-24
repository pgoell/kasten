// @vitest-environment node
import { shareTodo, sourceOf, storyOf } from "@/lib/panes/html/html-share";

const PAGE = "01 Periodic/05 Newspaper/2026-10-26.html";
const DAILY = "01 Periodic/00 Daily/2026-10-26.md";

describe("shareTodo", () => {
  it("puts the headline in the words, the source and the paper in the description, and is due the day saved", () => {
    const story = { heading: "First story", anchor: "s1", source: "https://news.example/one" };
    expect(shareTodo(PAGE, story, DAILY, "2026-10-26")).toEqual({
      words: "share First story #share #private",
      description: `https://news.example/one\n[[${PAGE}#s1|in the paper]]`,
      due: "2026-10-26",
      due_hard: true,
    });
  });

  it("links only the paper where the story names no source", () => {
    const story = { heading: "First story", anchor: "s1", source: "" };
    expect(shareTodo(PAGE, story, DAILY, "2026-10-26").description).toBe(
      `[[${PAGE}#s1|in the paper]]`,
    );
  });

  it("takes the link and tag syntax out of a headline, so it gives the todo no tag", () => {
    const story = { heading: "A [b] #c | d", anchor: "s1", source: "https://x.example/" };
    expect(shareTodo(PAGE, story, DAILY, "2026-10-26").words).toBe("share A b c d #share #private");
  });

  it("names the page where the story has no headline", () => {
    const story = { heading: "", anchor: "s1", source: "" };
    expect(shareTodo(PAGE, story, DAILY, "2026-10-26").words).toBe(
      "share 2026-10-26.html #share #private",
    );
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
