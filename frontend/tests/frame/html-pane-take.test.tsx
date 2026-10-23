/**
 * Taking a passage from a page in the real pane (#787): the button over a drag,
 * `y`, the take's line in today's dump, the marks on the page and the Undo. The
 * page is served by `servePage`, drawn by the real `HtmlPane`, and answered by
 * the stubbed API in `./html-take-api`. Hostile pages and touch are in the
 * sibling `html-pane-take-hostile.test.tsx`.
 */

import "./html-take-api";
import { commands as browser, page, userEvent } from "vitest/browser";
import { takenQuote } from "@/lib/html-take";
import { noteName } from "@/lib/note-path";
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
const LEFT_PATH = "take-list-left.html";
const RIGHT_PATH = "take-list-right.html";

/** Eight notes with names long enough to wrap in a short pane, newest first. */
const RECENT = Array.from(
  { length: 8 },
  (_, i) =>
    `Notes/A note with a very long name about replication lag across three regions and more ${i}.md`,
);

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
  // The button, not a second `y`: a `y` the page relays takes once per visit (security review).
  await userEvent.click(takeButton(mounted) as HTMLButtonElement);
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

it("the take toast stays small on a wide pane", async () => {
  await browser.servePage(PLAIN_PATH, PLAIN);
  render(mounted, [PLAIN_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await select(frame, ["line", 0, "line", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);

  await userEvent.keyboard("y");

  await expect.poll(() => mounted.host.querySelector("[role='status']") !== null).toBe(true);
  const toast = mounted.host.querySelector("[role='status']") as HTMLElement;
  expect(toast.getBoundingClientRect().width).toBeLessThanOrEqual(448);
  expect(
    Math.abs(toast.getBoundingClientRect().left - mounted.host.getBoundingClientRect().left),
  ).toBeLessThanOrEqual(16);
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

/** The rows of the take toast's list of recent notes. */
function listRows(): HTMLButtonElement[] {
  return [...mounted.host.querySelectorAll<HTMLButtonElement>("[role='status'] li button")];
}

/** Takes the first passage of the first pane, then opens its Put it in a note list. */
async function openList(frame: HTMLIFrameElement) {
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  await userEvent.keyboard("y");
  await expect.poll(() => buttonNamed("Put it in a note") !== undefined).toBe(true);
  await userEvent.click(buttonNamed("Put it in a note") as HTMLButtonElement);
  await expect.poll(() => listRows().length).toBe(8);
}

it("the put it in a note list stays inside a short split pane at 1440", async () => {
  await page.viewport(1440, 420);
  api.recent = RECENT;
  await browser.servePage(LEFT_PATH, NEWS);
  await browser.servePage(RIGHT_PATH, NEWS);
  render(mounted, [LEFT_PATH, RIGHT_PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await openList(frame);

  const pane = mounted.host.querySelector("[data-pane]") as HTMLElement;
  const toast = pane.querySelector("[role='status']") as HTMLElement;
  const list = toast.querySelector("ul") as HTMLUListElement;
  const rows = listRows();
  expect({
    toast: inside(toast, pane),
    put: inside(buttonNamed("Put it in a note") as HTMLElement, pane),
    undo: inside(buttonNamed("Undo") as HTMLElement, pane),
    scrolls: list.scrollHeight > list.clientHeight,
    oneLine: rows.every((row) => row.getBoundingClientRect().height <= 40),
    titles: rows.map((row) => row.title),
  }).toEqual({
    toast: true,
    put: true,
    undo: true,
    scrolls: true,
    oneLine: true,
    titles: RECENT.map(noteName),
  });
});

it("the put it in a note list stays inside a short split pane at 390", async () => {
  await page.viewport(390, 560);
  await browser.emulateMedia({ touch: true });
  api.recent = RECENT;
  await browser.servePage(LEFT_PATH, NEWS);
  await browser.servePage(RIGHT_PATH, NEWS);
  render(mounted, [LEFT_PATH, RIGHT_PATH], true);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await openList(frame);

  const pane = mounted.host.querySelector("[data-pane]") as HTMLElement;
  const toast = pane.querySelector("[role='status']") as HTMLElement;
  const list = toast.querySelector("ul") as HTMLUListElement;
  const rows = listRows();
  expect({
    toast: inside(toast, pane),
    put: inside(buttonNamed("Put it in a note") as HTMLElement, pane),
    undo: inside(buttonNamed("Undo") as HTMLElement, pane),
    scrolls: list.scrollHeight > list.clientHeight,
    oneLine: rows.every((row) => row.getBoundingClientRect().height <= 40),
    titles: rows.map((row) => row.title),
  }).toEqual({
    toast: true,
    put: true,
    undo: true,
    scrolls: true,
    oneLine: true,
    titles: RECENT.map(noteName),
  });

  await userEvent.click(listRows()[7] as HTMLButtonElement);
  await expect.poll(() => api.notes[RECENT[7] as string] ?? "").toContain("## Highlights");
});

it.each([["on"], ["off"]])(
  "Tab reaches the last of 8 notes in the list and Enter puts the passage there (vim %s)",
  async (vim) => {
    localStorage.setItem("kasten.vim", vim);
    await page.viewport(1440, 420);
    api.recent = RECENT;
    await browser.servePage(NEWS_PATH, NEWS);
    render(mounted, [NEWS_PATH]);
    const frame = frameOf(mounted, 0);
    await ready(frame);
    await openList(frame);

    const pane = mounted.host.querySelector("[data-pane]") as HTMLElement;
    const last = listRows()[7] as HTMLButtonElement;
    // From the Put button, past Undo, down the list: the eighth row is the last stop.
    for (let i = 0; i < 12 && document.activeElement !== last; i++) await userEvent.tab();
    expect(inside(last, pane)).toBe(true);

    await userEvent.keyboard("{Enter}");
    await expect.poll(() => api.notes[RECENT[7] as string] ?? "").toContain("## Highlights");
  },
);
