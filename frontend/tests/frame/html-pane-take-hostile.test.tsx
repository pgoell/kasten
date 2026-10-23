/**
 * Taking from a page that is not the reader's own, and taking on a touch screen
 * (#787). A nested frame, a window the page opens and a fake selection with the
 * page out of focus each post a selection and a `y` to kasten, and none of them
 * may take. The touch case puts the button under the words and taps it.
 */

import "./html-take-api";
import { commands as browser, page, userEvent } from "vitest/browser";
import {
  api,
  ask,
  buttonParts,
  frameOf,
  heardFrom,
  inFrame,
  inside,
  type Mounted,
  panelOf,
  ready,
  render,
  select,
  setUp,
  sourceOf,
  takeButton,
  tearDown,
} from "./html-take-fixture";
import { HOSTILE, NEWS, POPUP } from "./html-take-pages";

const PATH = "take-hostile.html";
const FIRST = `[[${PATH}#2026-10-07-evals-01|First story]]`;

let mounted: Mounted;

beforeEach(async () => {
  mounted = await setUp();
});

afterEach(async () => {
  await tearDown(mounted);
});

it("a nested frame posting a selection and y takes nothing", async () => {
  await browser.servePage(PATH, HOSTILE);
  render(mounted, [PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await userEvent.click(frame);
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);

  frame.contentWindow?.postMessage({ probe: "nest" }, "*");
  await expect.poll(() => heardFrom("nested")).toBe(true);
  // The nested frame also forged a take with id 1, which the page refuses by its source.
  expect({ dumps: api.dumps.length, parts: buttonParts(mounted)[2] }).toEqual({
    dumps: 0,
    parts: "First story",
  });
  expect((await ask(frame, { probe: "marks" }, "marks")).texts).toEqual([]);

  // The page itself, focused, takes the passage it selected: the refusal above is not a page that never answered.
  await userEvent.keyboard("y");
  await expect.poll(() => api.dumps.length).toBe(1);
  expect(api.dumps[0]).toContain(FIRST);
});

it("a window the page opens posting a selection and y takes nothing", async () => {
  await browser.servePage(PATH, HOSTILE);
  await browser.servePage("take-popup.html", POPUP);
  render(mounted, [PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await userEvent.click(frame);
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);

  await userEvent.click(inFrame(frame).getByRole("button", { name: "Open a window" }));
  await expect.poll(() => heardFrom("popup")).toBe(true);
  const popup = sourceOf("popup") as Window | null;
  try {
    expect({ dumps: api.dumps.length, parts: buttonParts(mounted)[2] }).toEqual({
      dumps: 0,
      parts: "First story",
    });

    // A click back into the page, which the window the page opened may have taken the focus from.
    await userEvent.click(frame);
    await select(frame, ["p1", 0, "p1", 5]);
    await expect.poll(() => takeButton(mounted) !== null).toBe(true);
    await userEvent.keyboard("y");
    await expect.poll(() => api.dumps.length).toBe(1);
    expect(api.dumps[0]).toContain(FIRST);
  } finally {
    (popup as Window | null)?.close();
  }
});

it("a fake selection while the page is not focused shows no button", async () => {
  await browser.servePage(PATH, HOSTILE);
  render(mounted, [PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);

  await ask(frame, { probe: "fake" }, "faked");
  expect(takeButton(mounted)).toBeNull();

  // The same fake, once the page holds the focus: the message was heard all along.
  await userEvent.click(frame);
  await ask(frame, { probe: "fake" }, "faked");
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  expect(buttonParts(mounted)[2]).toBe("Fake");
});

it("with the which-key panel open, y takes nothing", async () => {
  await browser.servePage(PATH, NEWS);
  render(mounted, [PATH]);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await userEvent.click(frame);
  await select(frame, ["p2", 0, "p2", 6]);
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);

  await userEvent.keyboard(" ");
  await expect.poll(panelOf).not.toBeNull();
  await userEvent.keyboard("y");

  // Escape closes the panel. A new passage selected after it is taken by `y`, and
  // the dump holds that one alone, so the `y` pressed under the panel took nothing.
  await userEvent.keyboard("{Escape}");
  await expect.poll(panelOf).toBeNull();
  await select(frame, ["p1", 0, "p1", 5]);
  await expect.poll(() => buttonParts(mounted)[2]).toBe("First story");
  await userEvent.keyboard("y");

  await expect.poll(() => api.dumps.length).toBe(1);
  expect(api.dumps[0]).toContain(FIRST);
});

it("at 390x844 with touch, the button sits below the selection and a tap takes it", async () => {
  await page.viewport(390, 844);
  await browser.emulateMedia({ touch: true });
  await browser.servePage(PATH, NEWS);
  render(mounted, [PATH], true);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await userEvent.click(frame);

  await ask(frame, { probe: "touchSelect", range: ["p2", 0, "p2", 6] }, "selected");
  const { rect } = (await ask(frame, { probe: "selection" }, "selection")) as {
    rect: { bottom: number };
  };
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  const button = takeButton(mounted) as HTMLElement;

  const below = frame.getBoundingClientRect().top + rect.bottom + 32;
  // Measured before the tap: a take takes the button off the page, so a box read after it is empty.
  expect({
    gap: button.getBoundingClientRect().top >= below - 1,
    tall: button.getBoundingClientRect().height >= 44,
    inside: inside(button, frame),
  }).toEqual({ gap: true, tall: true, inside: true });

  await userEvent.click(button);

  await expect.poll(() => api.dumps.length).toBe(1);
  expect(api.dumps[0]).toContain(`[[${PATH}#2026-10-07-evals-02|Second story]]`);
});
