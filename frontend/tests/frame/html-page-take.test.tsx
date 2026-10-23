/**
 * Kasten's half of a selection and its marks in a frame (#787): what the page
 * posts when a passage is selected, and what `y`, `take` and `untake` do. The
 * page makes its selection on a message, since a frame's DOM is out of reach.
 */

import { userEvent } from "vitest/browser";
import {
  cleanup,
  FIELD_STYLE,
  field,
  keysSent,
  lastSelection,
  marks,
  marksPage,
  messages,
  mount,
  NESTED,
  NEWSPAPER,
  PLAIN,
  reported,
  selectMouse,
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

  selectMouse(["a", 6, "a", 11]);
  sendToPage({ kasten: "take" });

  const after = await marks();
  expect(before?.texts).toEqual([]);
  expect(after?.texts).toEqual(["bravo"]);
  expect(after?.html).toBe(before?.html);
  expect(after?.styles).toBe(0);
});

it("two takes stay marked, and untake removes only the last", async () => {
  await mount(marksPage());
  selectMouse(["a", 6, "a", 11]);
  sendToPage({ kasten: "take" });
  selectMouse(["b", 6, "b", 10]);
  sendToPage({ kasten: "take" });
  expect((await marks())?.texts).toEqual(["bravo", "echo"]);

  sendToPage({ kasten: "untake" });

  expect((await marks())?.texts).toEqual(["bravo"]);
});

it("a take on a plain page marks it too", async () => {
  await mount(marksPage());
  selectMouse(["a", 6, "a", 11]);

  sendToPage({ kasten: "take" });

  expect((await marks())?.texts).toEqual(["bravo"]);
});

it("a take message from another window is ignored", async () => {
  await mount(marksPage("", NESTED));
  selectMouse(["a", 6, "a", 11]);

  sendToPage("nest");
  await expect.poll(() => messages.some((m) => m.fixture === "heard")).toBe(true);
  expect((await marks())?.texts).toEqual([]);

  sendToPage({ kasten: "take" });
  expect((await marks())?.texts).toEqual(["bravo"]);
});

it("a take with nothing selected before marks nothing", async () => {
  await mount(marksPage());
  sendToPage({ kasten: "take" });
  expect((await marks())?.texts).toEqual([]);

  selectMouse(["a", 6, "a", 11]);
  sendToPage({ kasten: "take" });

  expect((await marks())?.texts).toEqual(["bravo"]);
});

it("a take clears the page's selection so the mark shows", async () => {
  await mount(marksPage());
  selectMouse(["a", 6, "a", 11]);
  expect((await marks())?.selection).toBe("bravo");

  sendToPage({ kasten: "take" });

  const after = await marks();
  expect(after?.texts).toEqual(["bravo"]);
  expect(after?.selection).toBe("");
});
