/**
 * Kasten's half of a selection and its marks in a frame (#787): what the page
 * posts when a passage is selected, and what `y`, `take` and `untake` do. Then
 * the Share later button on a newspaper's stories: where it goes, what a press
 * posts, and what `shared` and `unshared` do to it. The page makes its selection
 * and presses its buttons on a message, since a frame's DOM is out of reach.
 */

import { userEvent } from "vitest/browser";
import {
  atStart,
  cleanup,
  FIELD_STYLE,
  field,
  keysSent,
  lastSelection,
  type Message,
  marks,
  marksPage,
  messages,
  mount,
  NESTED,
  NEWSPAPER,
  PLAIN,
  REPORT,
  reported,
  SELECTING,
  selectMouse,
  selectPosted,
  sendToPage,
} from "./page-script-harness";

afterEach(cleanup);

it("a mouse selection posts its text, heading, story id and rect", async () => {
  await mount(NEWSPAPER);
  selectMouse(["b", 0, "b", 5]);

  await expect.poll(() => lastSelection()?.text).toBe("Delta");
  expect(lastSelection()?.heading).toBe("Second story");
  expect(lastSelection()?.anchor).toBe("2026-10-07-evals-02");
  const rect = lastSelection()?.rect;
  expect(rect && rect.right > rect.left && rect.bottom > rect.top).toBe(true);
});

it("a selection on a plain page takes the nearest element id as its anchor", async () => {
  await mount(PLAIN);
  selectMouse(["line", 0, "line", 5]);

  await expect.poll(() => lastSelection()?.text).toBe("Alpha");
  expect(lastSelection()?.anchor).toBe("line");
});

it("a page with no heading posts an empty heading", async () => {
  await mount(PLAIN);
  selectMouse(["line", 0, "line", 5]);

  await expect.poll(() => lastSelection()?.text).toBe("Alpha");
  expect(lastSelection()?.heading).toBe("");
});

it("a selection across two articles takes heading and anchor from where it starts", async () => {
  await mount(NEWSPAPER);
  selectMouse(["a", 0, "b", 4]);

  await expect.poll(() => lastSelection()?.text).toContain("Alpha");
  expect(lastSelection()?.heading).toBe("First story");
  expect(lastSelection()?.anchor).toBe("2026-10-07-evals-01");
});

it("Shift with an arrow key posts the selection", async () => {
  const element = await mount(NEWSPAPER);
  await userEvent.click(element);
  sendToPage({ range: ["a", 0, "a", 5] });

  await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");

  await expect.poll(() => lastSelection()?.text).toContain("Alpha");
});

it("an emptied selection posts empty text", async () => {
  await mount(NEWSPAPER);
  selectMouse(["b", 0, "b", 5]);
  await expect.poll(() => lastSelection()?.text).toBe("Delta");

  sendToPage({ clear: true });

  await expect.poll(() => lastSelection()?.text).toBe("");
});

it("at the end of a touch selection the selection is posted", async () => {
  await mount(NEWSPAPER);

  // A touch pointerdown, then a selection with no mouseup: only selectionchange can post it.
  sendToPage({ touch: true, range: ["b", 0, "b", 5] });

  await expect.poll(() => lastSelection()?.text).toBe("Delta");
});

it("scrolling the page posts the selection again with its new rect", async () => {
  await mount(NEWSPAPER);
  selectMouse(["a", 0, "a", 5]);
  await expect.poll(() => lastSelection()?.text).toBe("Alpha");
  const top = lastSelection()?.rect?.top;
  expect(top).toBeDefined();

  sendToPage({ scrollBy: 100 });

  await expect.poll(() => lastSelection()?.rect?.top).toBeLessThan(top ?? 0);
});

it("y with text selected goes to kasten and the page does not see it", async () => {
  const element = await mount(NEWSPAPER);
  await userEvent.click(element);
  sendToPage({ range: ["a", 0, "a", 5] });

  await userEvent.keyboard("y");
  await userEvent.keyboard("a");

  await expect.poll(() => reported("a")).toBe(true);
  expect(keysSent()).toEqual(["y"]);
  expect(reported("y")).toBe(false);
});

it("y with nothing selected stays the page's", async () => {
  const element = await mount(NEWSPAPER);
  await userEvent.click(element);

  await userEvent.keyboard("y");
  await userEvent.keyboard("a");

  await expect.poll(() => reported("a")).toBe(true);
  expect(reported("y")).toBe(true);
  expect(keysSent()).toEqual([]);

  // With text selected the same key is kasten's.
  sendToPage({ range: ["a", 0, "a", 5] });
  await userEvent.keyboard("y");
  await userEvent.keyboard("b");

  await expect.poll(() => reported("b")).toBe(true);
  expect(keysSent()).toEqual(["y"]);
});

it("y in a text field stays typing", async () => {
  const element = await mount(field(`<input id="field" style="${FIELD_STYLE}">`));
  await userEvent.click(element);

  await userEvent.keyboard("y");
  await userEvent.keyboard("{Escape}");

  await expect.poll(() => reported("Escape")).toBe(true);
  const values = messages.filter((m) => m.fixture === "value");
  expect(values.at(-1)?.value).toBe("y");
  expect(keysSent()).toEqual([]);
});

it("a take marks the passage with the kasten-taken highlight and leaves the markup alone", async () => {
  await mount(marksPage('<meta name="kasten-theme" content="tokens">'));
  const before = await marks();

  const seq = await selectPosted(["a", 6, "a", 11]);
  sendToPage({ kasten: "take", id: 1, seq });

  const after = await marks();
  expect(before?.texts).toEqual([]);
  expect(after?.texts).toEqual(["bravo"]);
  expect(after?.html).toBe(before?.html);
  expect(after?.styles).toBe(0);
});

it("two takes stay marked, and untake removes only the last", async () => {
  await mount(marksPage());
  sendToPage({ kasten: "take", id: 1, seq: await selectPosted(["a", 6, "a", 11]) });
  sendToPage({ kasten: "take", id: 2, seq: await selectPosted(["b", 6, "b", 10]) });
  expect((await marks())?.texts).toEqual(["bravo", "echo"]);

  sendToPage({ kasten: "untake", id: 2 });

  expect((await marks())?.texts).toEqual(["bravo"]);
});

it("a take on a plain page marks it too", async () => {
  await mount(marksPage());
  const seq = await selectPosted(["a", 6, "a", 11]);

  sendToPage({ kasten: "take", id: 1, seq });

  expect((await marks())?.texts).toEqual(["bravo"]);
});

it("a take message from another window is ignored", async () => {
  await mount(marksPage("", NESTED));
  const seq = await selectPosted(["a", 6, "a", 11]);

  sendToPage("nest");
  await expect.poll(() => messages.some((m) => m.fixture === "heard")).toBe(true);
  expect((await marks())?.texts).toEqual([]);

  sendToPage({ kasten: "take", id: 2, seq });
  expect((await marks())?.texts).toEqual(["bravo"]);
});

it("a take with nothing selected before marks nothing", async () => {
  await mount(marksPage());
  sendToPage({ kasten: "take", id: 1, seq: 1 });
  expect((await marks())?.texts).toEqual([]);

  sendToPage({ kasten: "take", id: 1, seq: await selectPosted(["a", 6, "a", 11]) });

  expect((await marks())?.texts).toEqual(["bravo"]);
});

it("a take clears the page's selection so the mark shows", async () => {
  await mount(marksPage());
  const seq = await selectPosted(["a", 6, "a", 11]);
  expect((await marks())?.selection).toBe("bravo");

  sendToPage({ kasten: "take", id: 1, seq });

  const after = await marks();
  expect(after?.texts).toEqual(["bravo"]);
  expect(after?.selection).toBe("");
});

it("untake removes the mark of its own take, not the last", async () => {
  await mount(marksPage());
  sendToPage({ kasten: "take", id: 1, seq: await selectPosted(["a", 6, "a", 11]) });
  sendToPage({ kasten: "take", id: 2, seq: await selectPosted(["b", 6, "b", 10]) });

  sendToPage({ kasten: "untake", id: 1 });

  expect((await marks())?.texts).toEqual(["echo"]);
});

it("a take marks the passage of its number, and keeps a selection made since (#897)", async () => {
  await mount(marksPage());
  const first = await selectPosted(["a", 6, "a", 11]);
  await selectPosted(["b", 6, "b", 10]);

  sendToPage({ kasten: "take", id: 1, seq: first });

  const after = await marks();
  expect(after?.texts).toEqual(["bravo"]);
  expect(after?.selection).toBe("echo");
});

it("a take whose number the page did not post marks nothing (#897)", async () => {
  await mount(marksPage());
  const seq = await selectPosted(["a", 6, "a", 11]);

  sendToPage({ kasten: "take", id: 1, seq: seq + 1 });
  sendToPage({ kasten: "take", id: 2 });

  const after = await marks();
  expect(after?.texts).toEqual([]);
  expect(after?.selection).toBe("bravo");
});

it("a take after a scroll posted the selection again marks it and clears it (#897)", async () => {
  await mount(marksPage());
  const seq = await selectPosted(["a", 6, "a", 11]);
  sendToPage({ scrollBy: 100 });
  await expect.poll(() => (lastSelection()?.seq ?? 0) > seq).toBe(true);

  sendToPage({ kasten: "take", id: 1, seq: lastSelection()?.seq });

  const after = await marks();
  expect(after?.texts).toEqual(["bravo"]);
  expect(after?.selection).toBe("");
});

it("a take of a passage a scroll posted again since still clears it (#897)", async () => {
  await mount(marksPage());
  const seq = await selectPosted(["a", 6, "a", 11]);
  sendToPage({ scrollBy: 100 });
  await expect.poll(() => (lastSelection()?.seq ?? 0) > seq).toBe(true);

  sendToPage({ kasten: "take", id: 1, seq });

  const after = await marks();
  expect(after?.texts).toEqual(["bravo"]);
  expect(after?.selection).toBe("");
});

it("a selection that starts at the document itself still posts", async () => {
  await mount(NEWSPAPER);
  selectMouse(["document", 0, "b", 5]);

  await expect.poll(() => lastSelection()?.text).toContain("Delta");
});

it("a long selection is cut on a whole character, not in the middle of a pair", async () => {
  // The charset is set, or the emoji reach the page as Latin-1 and no pair is ever made.
  await mount(
    atStart(`<meta charset="utf-8"><p id="e">a${"\u{1F600}".repeat(10000)}</p>${SELECTING}`),
  );
  selectMouse(["e", 0, "e", 20001]);

  await expect.poll(() => lastSelection()?.text?.endsWith("\u{1F600}")).toBe(true);
  expect(Array.from(lastSelection()?.text ?? "")).toHaveLength(10000);
});

/**
 * Presses the nth button on "press", and answers "buttons" with every button's
 * label and state and the page's own text, which must not take in a label.
 */
const PRESSING = `<script>
const all = () => [...document.querySelectorAll("article > span")].map((host) => host.shadowRoot.querySelector("button"));
addEventListener("message", (event) => {
  const data = event.data;
  if (typeof data !== "object" || data === null) return;
  if (typeof data.press === "number") all()[data.press].click();
  if (data.buttons) parent.postMessage({ fixture: "buttons", labels: all().map((b) => b.textContent), disabled: all().map((b) => b.disabled), text: document.body.innerText }, "*");
});
</script>`;

/** A story with a marked source, one with only an outside link, and an article with no id. */
const STORIES = atStart(
  `<article><a class="sid" href="#s1">#s1</a><h2>First story</h2><p>Alpha <a href="https://example.com/other">other</a> and <a class="src" href="https://news.example/one">the source</a>.</p></article><article><a class="sid" href="#s2">#s2</a><h2>Second story</h2><p>Delta <a href="other.html">a vault page</a>, then <a href="https://blog.example/two?a=1">the post</a>.</p></article><article><h2>No id</h2><p>Echo.</p></article>${REPORT}${PRESSING}`,
);

async function buttons(): Promise<Message | undefined> {
  const before = messages.length;
  sendToPage({ buttons: true });
  await expect.poll(() => messages.slice(before).some((m) => m.fixture === "buttons")).toBe(true);
  return messages.slice(before).find((m) => m.fixture === "buttons");
}

const shares = () => messages.filter((m) => m.kasten === "share");

it("puts a button on each story with an id, and keeps its label out of the page's text", async () => {
  await mount(STORIES);

  const state = await buttons();
  expect(state?.labels).toEqual(["Share later", "Share later"]);
  expect(state?.text).not.toContain("Share later");
});

it("a press posts the story's heading, id and marked source", async () => {
  await mount(STORIES);
  sendToPage({ press: 0 });

  await expect.poll(() => shares().length).toBe(1);
  expect(shares()[0]).toMatchObject({
    heading: "First story",
    anchor: "s1",
    source: "https://news.example/one",
  });
});

it("with no marked source the first link off the page's host is the source", async () => {
  await mount(STORIES);
  sendToPage({ press: 1 });

  await expect.poll(() => shares().length).toBe(1);
  expect(shares()[0]?.source).toBe("https://blog.example/two?a=1");
});

it("shared marks the button saved, and unshared gives it back", async () => {
  await mount(STORIES);

  sendToPage({ kasten: "shared", anchor: "s2" });
  await expect
    .poll(async () => (await buttons())?.labels)
    .toEqual(["Share later", "Saved to share"]);
  expect((await buttons())?.disabled).toEqual([false, true]);

  sendToPage({ kasten: "unshared", anchor: "s2" });
  await expect.poll(async () => (await buttons())?.labels).toEqual(["Share later", "Share later"]);
});
