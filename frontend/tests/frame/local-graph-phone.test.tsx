/**
 * `Space g l` on a phone opens the local graph as the bottom sheet over the window
 * (#798, S11), and the Graph button opens the same sheet. The desktop's side sheet
 * is in `local-graph-sheet.test.tsx`.
 */

import { waitFor } from "@testing-library/react";
import { act } from "react";
import { page } from "vitest/browser";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import {
  graphButton,
  mountLesson,
  pressSpaceGL,
  registerLessonFixture,
  sheet,
} from "./local-graph-fixture";
import { PATIENCE, visibleEditor } from "./reader-fixture";

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

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerLessonFixture();

it("on a phone, Space g l opens the local graph as a sheet and no pane", async () => {
  await page.viewport(390, 844);
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    const tabsBefore = host.querySelectorAll("[role='tab']").length;

    pressSpaceGL(host);

    await waitFor(() => expect(sheet()).not.toBeNull(), { timeout: 5000 });
    expect(host.querySelectorAll("[role='tab']").length).toBe(tabsBefore);
    expect(host.textContent).not.toContain("graph of Lesson");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A12 on a phone a tap outside the graph sheet closes it, the sheet leaving downwards, and the focus is back on the note", async () => {
  await page.viewport(390, 844);
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    pressSpaceGL(host);
    await waitFor(() => expect(sheet()).not.toBeNull(), { timeout: 5000 });
    const panel = sheet() as HTMLElement;

    // The open slide comes to rest first: a tap during it closes from where it stands, which
    // is the top, so the panel would not move on the way down.
    await expect.poll(() => panel.style.transform, PATIENCE).toBe("translate3d(0px, 0px, 0px)");

    // Every transform the panel is given while it leaves, read as the spring writes them.
    const offsets: string[] = [];
    const watch = new MutationObserver(() => offsets.push(panel.style.transform));
    watch.observe(panel, { attributes: true, attributeFilter: ["style"] });
    (panel.previousElementSibling as HTMLElement).click();

    await waitFor(() => expect(sheet()).toBeNull(), { timeout: 5000 });
    watch.disconnect();
    // The browser writes the value back as `translate3d(0px, Npx, 0px)`.
    const moved = offsets.map((each) => /translate3d\(0px, ([0-9.]+)px, 0px\)/.exec(each)?.[1]);
    expect(moved.some((px) => px !== undefined && Number(px) > 0)).toBe(true);
    expect(document.activeElement).toBe(host.querySelector(".cm-content"));
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("A12 on a phone the Graph button opens the bottom sheet from the foot of the screen", async () => {
  await page.viewport(390, 844);
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  const root = await mountLesson(host);
  try {
    visibleEditor(host).focus();
    graphButton(host).click();
    await waitFor(() => expect(sheet()).not.toBeNull(), PATIENCE);
    const panel = sheet() as HTMLElement;

    await expect.poll(() => Math.round(panel.getBoundingClientRect().bottom)).toBe(844);
    expect(Math.round(panel.getBoundingClientRect().width)).toBe(390);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
