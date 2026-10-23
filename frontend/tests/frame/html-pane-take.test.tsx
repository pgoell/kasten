/**
 * Taking a passage from a page in the real pane (#787): the button over a drag,
 * `y`, the take's line in today's dump, the marks on the page and the Undo. The
 * page is served by `servePage`, drawn by the real `HtmlPane`, and answered by
 * the stubbed API in `./html-take-api`. Hostile pages and touch are in the
 * sibling `html-pane-take-hostile.test.tsx`.
 */

import "./html-take-api";
import { commands as browser, userEvent } from "vitest/browser";
import { takenQuote } from "@/lib/html-take";
import { toggleTheme } from "@/lib/theme";
import {
  api,
  ask,
  buttonNamed,
  buttonParts,
  frameOf,
  inFrame,
  inside,
  type Mounted,
  ready,
  render,
  select,
  setUp,
  takeButton,
  tearDown,
} from "./html-take-fixture";
import { NEWS, PLAIN } from "./html-take-pages";

const NEWS_PATH = "take-news.html";
const PLAIN_PATH = "take-plain.html";

let mounted: Mounted;

beforeEach(async () => {
  mounted = await setUp();
});

afterEach(async () => {
  await tearDown(mounted);
});

/** Drags from the second story's heading onto its first paragraph, as a reader does. */
async function dragIntoSecondStory(frame: HTMLIFrameElement) {
  await userEvent.dragAndDrop(
    inFrame(frame).getByRole("heading", { name: "Second story" }),
    inFrame(frame).getByTestId("p2"),
  );
}

it("a mouse drag over a story shows the take button with its heading, inside the frame", async () => {
  await browser.servePage(NEWS_PATH, NEWS);
  render(mounted, [NEWS_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);

  await dragIntoSecondStory(frame);

  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  expect(inside(takeButton(mounted) as HTMLElement, frame)).toBe(true);
  expect(buttonParts(mounted)).toEqual(["Take", "y", "Second story"]);
});

it("y in the page takes the passage into today's dump with a link to the story", async () => {
  await browser.servePage(NEWS_PATH, NEWS);
  render(mounted, [NEWS_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await dragIntoSecondStory(frame);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  const { text } = await ask(frame, { probe: "selection" }, "selection");

  await userEvent.keyboard("y");

  await expect.poll(() => api.dumps.length).toBe(1);
  const passage = { text: text as string, heading: "Second story", anchor: "2026-10-07-evals-02" };
  expect(api.dumps[0]).toBe(takenQuote(NEWS_PATH, passage));
  expect(api.dumps[0]).toContain(`[[${NEWS_PATH}#2026-10-07-evals-02|Second story]]`);
});

it("a click on the take button takes it and the page marks the passage", async () => {
  await browser.servePage(NEWS_PATH, NEWS);
  render(mounted, [NEWS_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);

  await userEvent.click(takeButton(mounted) as HTMLElement);

  await expect.poll(() => api.dumps.length).toBe(1);
  await expect
    .poll(async () => (await ask(frame, { probe: "marks" }, "marks")).texts)
    .toEqual(["Alpha"]);
});

it("Undo takes the dump line out and the mark off the page", async () => {
  await browser.servePage(NEWS_PATH, NEWS);
  render(mounted, [NEWS_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  await userEvent.keyboard("y");
  await expect.poll(() => buttonNamed("Undo") !== undefined).toBe(true);

  await userEvent.click(buttonNamed("Undo") as HTMLButtonElement);

  await expect.poll(() => api.puts.length).toBe(1);
  expect(api.puts[0]?.content).not.toContain("Alpha bravo");
  await expect.poll(async () => (await ask(frame, { probe: "marks" }, "marks")).texts).toEqual([]);
});

it("two takes stay marked after a theme switch and a scroll", async () => {
  await browser.servePage(NEWS_PATH, NEWS);
  render(mounted, [NEWS_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);

  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  await userEvent.keyboard("y");
  await expect.poll(() => api.dumps.length).toBe(1);
  await select(frame, ["p2", 0, "p2", 6]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  await userEvent.keyboard("y");
  await expect.poll(() => api.dumps.length).toBe(2);

  toggleTheme();
  await expect.poll(async () => (await ask(frame, { probe: "look" }, "look")).theme).toBe("dark");
  await ask(frame, { probe: "scroll", by: 200 }, "scroll");

  const marks = await ask(frame, { probe: "marks" }, "marks");
  expect(marks.texts).toEqual(["Alpha", "Yankee"]);
});

it("a plain page with only element ids takes its anchor from the nearest id", async () => {
  await browser.servePage(PLAIN_PATH, PLAIN);
  render(mounted, [PLAIN_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await select(frame, ["line", 0, "line", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);

  await userEvent.keyboard("y");

  await expect.poll(() => api.dumps.length).toBe(1);
  expect(api.dumps[0]).toBe(takenQuote(PLAIN_PATH, { text: "Alpha", heading: "", anchor: "line" }));
  expect(api.dumps[0]).toContain(`[[${PLAIN_PATH}#line|${PLAIN_PATH}]]`);
});

it("a page with no heading takes the file name as its source", async () => {
  await browser.servePage(PLAIN_PATH, PLAIN);
  render(mounted, [PLAIN_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await select(frame, ["line", 0, "line", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);

  await userEvent.keyboard("y");

  await expect.poll(() => mounted.host.querySelector("[role='status']") !== null).toBe(true);
  const sources = mounted.host.querySelectorAll("[role='status'] p");
  expect(sources[2]?.textContent).toBe(PLAIN_PATH);
});

it("a selection across two articles links to the first", async () => {
  await browser.servePage(NEWS_PATH, NEWS);
  render(mounted, [NEWS_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);

  await userEvent.dragAndDrop(inFrame(frame).getByTestId("p1"), inFrame(frame).getByTestId("p2"));
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  await userEvent.keyboard("y");

  await expect.poll(() => api.dumps.length).toBe(1);
  expect(api.dumps[0]).toContain(`[[${NEWS_PATH}#2026-10-07-evals-01|First story]]`);
});

it("scrolling the page moves the button with the words", async () => {
  await browser.servePage(NEWS_PATH, NEWS);
  render(mounted, [NEWS_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  const top = () => (takeButton(mounted) as HTMLElement).getBoundingClientRect().top;
  const before = top();

  await ask(frame, { probe: "scroll", by: 60 }, "scroll");

  await expect.poll(() => Math.round(before - top())).toBe(60);
});

it("two pages side by side: a selection in the right page puts the button only in the right pane", async () => {
  await browser.servePage("take-left.html", NEWS);
  await browser.servePage("take-right.html", NEWS);
  render(mounted, ["take-left.html", "take-right.html"]);
  const right = frameOf(mounted, 1);
  await ready(frameOf(mounted, 0));
  await ready(right);

  await userEvent.dragAndDrop(
    inFrame(right).getByRole("heading", { name: "Second story" }),
    inFrame(right).getByTestId("p2"),
  );

  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  const [left, rightPane] = mounted.host.querySelectorAll("[data-pane]");
  expect({
    left: left?.querySelector("[data-take]") ?? null,
    right: rightPane?.querySelector("[data-take]") !== null,
  }).toEqual({ left: null, right: true });
});
