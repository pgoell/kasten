/**
 * `Space g l` on a desktop: the pane beside the note when the pane is wide (I2), and
 * the 540 px side sheet over the note when the margin is not there (A9), with the
 * sheet's own behaviour: its labels, focus, Esc, scrim and lists. The phone's graph
 * is in `local-graph-phone.test.tsx`.
 */

import { waitFor } from "@testing-library/react";
import { act } from "react";
import { page, userEvent } from "vitest/browser";
import { fetchMentions } from "@/lib/api";
import { fetchGraph } from "@/lib/graph-api";
import { stubMatchMedia } from "../match-media";
import {
  graphButton,
  mountLesson,
  pressSpaceGL,
  readerOf,
  registerLessonFixture,
  sheet,
} from "./local-graph-fixture";
import { closeTree, leader, need, nextFrame, PATIENCE, visibleEditor } from "./reader-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTodos: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
    fetchMentions: vi.fn(),
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerLessonFixture();

it("I2 in a wide pane Space g l opens the graph as a pane beside the note and no sheet", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    // The tree folded, so the pane is 1320 px or more and the margin would show.
    await closeTree(host);
    await nextFrame();
    await nextFrame();
    pressSpaceGL(host);

    // The graph lands in a second pane beside the note, which is the desktop's answer.
    await waitFor(() => expect(host.querySelectorAll("[data-pane]").length).toBe(2), PATIENCE);
    expect(host.textContent).toContain("Lesson depth 1");
    expect(sheet()).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A9 in a narrow pane Space g l opens the 540 px side sheet over the note, with the graph and lists", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    // The tree is open at 1440, so the pane is under 1320 px and the margin is hidden.
    const reader = readerOf(host);
    expect(reader.getBoundingClientRect().width).toBeLessThan(1320);

    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    const panel = sheet() as HTMLElement;
    // The panel slides in from the edge, so its right edge is checked once it rests.
    await expect
      .poll(() =>
        Math.abs(panel.getBoundingClientRect().right - reader.getBoundingClientRect().right),
      )
      .toBeLessThan(1);

    expect(panel.getBoundingClientRect().width).toBeCloseTo(540, 0);
    expect(panel.textContent).toContain("Links");
    expect(panel.textContent).toContain("Backlinks");
    expect(panel.textContent).toContain("Unlinked mentions");
    expect(panel.querySelector("canvas")).not.toBeNull();
    expect(host.querySelectorAll("[data-pane]").length).toBe(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A8 in a narrow pane the Graph button beside the path opens the side sheet", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    const button = graphButton(host);
    expect(getComputedStyle(button).display).not.toBe("none");

    // A script's click does not move the focus, so the note keeps it, as a press in the note leaves it.
    visibleEditor(host).focus();
    button.click();

    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    expect(sheet()?.getBoundingClientRect().width).toBeCloseTo(540, 0);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A10 with vim on, Esc closes the side sheet and the note takes keys in normal mode", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host, "on");
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));

    // `j` onto the blank line and `j` again onto the paragraph, then `x` deletes its first
    // letter. In insert mode the two letters would be typed instead, and the text would grow.
    const editor = visibleEditor(host);
    const before = editor.textContent ?? "";
    await userEvent.keyboard("j");
    await userEvent.keyboard("j");
    await userEvent.keyboard("x");
    expect((editor.textContent ?? "").length).toBe(before.length - 1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A10 with vim off, Esc closes the side sheet and typing goes into the note", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host, "off");
  try {
    // With vim off the leader is not wired, so the Graph button opens the sheet.
    visibleEditor(host).focus();
    graphButton(host).click();
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));
    await userEvent.keyboard("Q");
    expect(visibleEditor(host).textContent).toContain("Q");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A10 a click outside the side sheet closes it", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    const panel = sheet() as HTMLElement;
    // The scrim is the element the panel sits after.
    (panel.previousElementSibling as HTMLElement).click();

    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A11 at 1440 with the tree open no graph is asked, no mentions read and no canvas made until the sheet opens", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    // The note has loaded: nothing has asked for the graph.
    expect(vi.mocked(fetchGraph)).toHaveBeenCalledTimes(0);
    expect(vi.mocked(fetchMentions)).toHaveBeenCalledTimes(0);
    expect(document.querySelectorAll("canvas").length).toBe(0);

    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    await waitFor(() => expect(vi.mocked(fetchGraph)).toHaveBeenCalledTimes(1), PATIENCE);
    expect(vi.mocked(fetchMentions)).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelectorAll("canvas").length).toBe(1), PATIENCE);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A7 in a wide pane the margin shows the graph and the Graph button is hidden; in a narrow one the margin is hidden and the button shows", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    // The tree open: the pane is narrow, so the margin is hidden and the button is there.
    const narrowMargin = need(host.querySelector<HTMLElement>("[data-margin='links']"), "margin");
    expect(getComputedStyle(narrowMargin).display).toBe("none");
    expect(getComputedStyle(graphButton(host)).display).not.toBe("none");

    await closeTree(host);

    const wideMargin = need(host.querySelector<HTMLElement>("[data-margin='links']"), "margin");
    expect(getComputedStyle(wideMargin).display).not.toBe("none");
    expect(getComputedStyle(graphButton(host)).display).toBe("none");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A5 in a split of two wide panes each margin draws its own note", async () => {
  await page.viewport(2900, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    await closeTree(host);
    // The split's new pane is empty: no note, so no reader and no margin yet.
    leader(host, [" ", "%"]);
    await waitFor(
      () => expect(host.querySelectorAll(".cm-content").length).toBeGreaterThan(1),
      PATIENCE,
    );
    // A click in the empty pane takes the focus into it, so the row below opens there.
    await userEvent.click(need(host.querySelectorAll<HTMLElement>(".cm-content")[1], "empty pane"));
    await nextFrame();

    // A row of the left margin opens Design Notes in the focused pane, the empty one on the
    // right. Then the left margin still draws Lesson and the right one draws Design Notes.
    // The row is drawn once the left margin's graph has answered, so the test waits for it.
    const rowNamed = () =>
      [
        ...(host
          .querySelectorAll<HTMLElement>("[data-reader]")[0]
          ?.querySelectorAll<HTMLElement>("[data-margin='links'] button") ?? []),
      ].find((each) => each.textContent === "Design Notes");
    await waitFor(() => expect(rowNamed()).toBeDefined(), PATIENCE);
    need(rowNamed(), "Design Notes row").click();
    await waitFor(
      () =>
        expect(
          host.querySelectorAll("[data-reader]")[1]?.querySelector(".cm-content")?.textContent,
        ).toContain("Design Notes"),
      PATIENCE,
    );

    await waitFor(
      () => expect(host.querySelectorAll("[data-margin='links'] canvas").length).toBe(2),
      PATIENCE,
    );
    const asked = vi.mocked(fetchGraph).mock.calls.map(([ask]) => ask.around);
    expect(asked).toContain("Lesson.md");
    expect(asked).toContain("Design Notes.md");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("I8 a pane that grows past 1320 px with the side sheet open closes the sheet", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);

    // Folding the tree widens the pane past 1320 px: the margin takes the graph's place.
    await closeTree(host);

    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
    const margin = need(host.querySelector<HTMLElement>("[data-margin='links']"), "margin");
    expect(getComputedStyle(margin).display).not.toBe("none");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("I7 the side sheet is a labelled dialog, Tab reaches the depth switch and the rows, and a letter typed in it never reaches the note", async () => {
  await page.viewport(1440, 900);
  stubMatchMedia({});
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host, "on");
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    const panel = sheet() as HTMLElement;
    expect(panel.getAttribute("aria-label")).toBe("Local graph");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(panel);

    // The depth switch's first button, then its second, then the first row of Links.
    const buttonNamed = (text: string) =>
      need(
        [...panel.querySelectorAll<HTMLElement>("button")].find(
          (each) => each.textContent === text,
        ),
        `${text} button`,
      );
    await userEvent.tab();
    expect(document.activeElement).toBe(buttonNamed("Direct"));
    await userEvent.tab();
    expect(document.activeElement).toBe(buttonNamed("Two steps"));
    await userEvent.tab();
    expect(document.activeElement).toBe(buttonNamed("Design Notes"));

    // Letters typed on a button do nothing to the note under the sheet. In normal mode `x`
    // would delete a character and `d` would start an operator, so the text would change.
    const editor = need(host.querySelector<HTMLElement>(".cm-content"), "note editor");
    const before = editor.textContent ?? "";
    await userEvent.keyboard("x");
    await userEvent.keyboard("d");
    expect(editor.textContent).toBe(before);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(sheet()).toBeNull(), PATIENCE);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
