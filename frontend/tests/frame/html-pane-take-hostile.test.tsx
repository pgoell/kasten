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
  buttonNamed,
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
import { HOSTILE, page as htmlPage, NEWS, POPUP } from "./html-take-pages";

const PATH = "take-hostile.html";
const FIRST = `[[${PATH}#2026-10-07-evals-01|First story]]`;
const LOW_TEXT =
  "Replicas in Frankfurt and Virginia stay within one second of the primary at the 99th percentile.";
/** A paragraph of about 13 lines from near 100 px, so on a phone it ends just past the frame's middle. */
const TALL_TEXT =
  "Replicas in Frankfurt and Virginia stay within one second of the primary at the 99th percentile. "
    .repeat(5)
    .trimEnd();
const TALL = htmlPage(
  "Tall",
  `<main style="font:16px/1.6 Georgia,serif;padding:24px 32px"><div style="height:60px"></div><p id="p1">${TALL_TEXT}</p><div style="height:1600px"></div></main>`,
);

/** A paragraph under a 560 px spacer, so on a phone its words lie in the frame's lower half. */
const LOW = htmlPage(
  "Low",
  `<main style="font:16px/1.6 Georgia,serif;padding:24px 32px"><div style="height:560px"></div><p id="p1">${LOW_TEXT}</p><div style="height:1600px"></div></main>`,
);

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
  // On the words, not the frame's middle: at 390 that lies a few px from the second
  // story's Share later button, which with another font is under it and saves a dump (#1213).
  await userEvent.click(inFrame(frame).getByTestId("p2"));

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

  // The whole list and the whole quote, so a second dump says what it was, and a
  // Share later line, which links the same story, is not taken for the take.
  await expect
    .poll(() => api.dumps)
    .toEqual([`> Yankee\n>\n> [[${PATH}#2026-10-07-evals-02|Second story]]`]);
});

it("at 390 with touch, the toast goes to the top clear of a low passage", async () => {
  await page.viewport(390, 844);
  await browser.emulateMedia({ touch: true });
  await browser.servePage(PATH, LOW);
  render(mounted, [PATH], true);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await userEvent.click(frame);

  await ask(frame, { probe: "touchSelect", range: ["p1", 0, "p1", LOW_TEXT.length] }, "selected");
  const { rect } = (await ask(frame, { probe: "selection" }, "selection")) as {
    rect: { top: number; bottom: number };
  };
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  await userEvent.click(takeButton(mounted) as HTMLElement);
  await expect.poll(() => mounted.host.querySelector("[role='status']") !== null).toBe(true);

  // The passage in the frame's own px, read against the frame on the page.
  const box = frame.getBoundingClientRect();
  const words = { top: box.top + rect.top, bottom: box.top + rect.bottom };
  const toast = mounted.host.querySelector("[role='status']") as HTMLElement;
  const at = toast.getBoundingClientRect();
  expect({
    low: rect.top > frame.clientHeight / 2,
    clear: at.bottom <= words.top || at.top >= words.bottom,
    top: Math.abs(at.top - box.top) <= 16,
    inside: inside(toast, frame),
  }).toEqual({ low: true, clear: true, top: true, inside: true });

  await expect.poll(() => buttonNamed("Undo") !== undefined).toBe(true);
  await userEvent.click(buttonNamed("Undo") as HTMLButtonElement);
  await expect.poll(() => api.puts.length).toBe(1);
  await expect.poll(async () => (await ask(frame, { probe: "marks" }, "marks")).texts).toEqual([]);
});

it("at 390 with touch, a high passage keeps the toast at the foot", async () => {
  await page.viewport(390, 844);
  await browser.emulateMedia({ touch: true });
  await browser.servePage(PATH, NEWS);
  render(mounted, [PATH], true);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  // On the words, for the Share later button the first touch test gives.
  await userEvent.click(inFrame(frame).getByTestId("p1"));

  await ask(frame, { probe: "touchSelect", range: ["p1", 0, "p1", 6] }, "selected");
  const { rect } = (await ask(frame, { probe: "selection" }, "selection")) as {
    rect: { bottom: number };
  };
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  await userEvent.click(takeButton(mounted) as HTMLElement);
  await expect.poll(() => mounted.host.querySelector("[role='status']") !== null).toBe(true);

  const box = frame.getBoundingClientRect();
  const toast = mounted.host.querySelector("[role='status']") as HTMLElement;
  expect({
    high: rect.bottom < frame.clientHeight / 2,
    foot: Math.abs(toast.getBoundingClientRect().bottom - box.bottom) <= 16,
  }).toEqual({ high: true, foot: true });
});

it("at 390 with touch, a tall passage that ends just past the middle keeps the toast clear of it", async () => {
  await page.viewport(390, 844);
  await browser.emulateMedia({ touch: true });
  await browser.servePage(PATH, TALL);
  render(mounted, [PATH], true);
  const frame = frameOf(mounted, 0);
  await ready(frame);
  await userEvent.click(frame);

  await ask(frame, { probe: "touchSelect", range: ["p1", 0, "p1", TALL_TEXT.length] }, "selected");
  const { rect } = (await ask(frame, { probe: "selection" }, "selection")) as {
    rect: { top: number; bottom: number };
  };
  await expect.poll(() => takeButton(mounted) !== null).toBe(true);
  await userEvent.click(takeButton(mounted) as HTMLElement);
  await expect.poll(() => mounted.host.querySelector("[role='status']") !== null).toBe(true);

  const box = frame.getBoundingClientRect();
  const h = frame.clientHeight;
  const words = { top: box.top + rect.top, bottom: box.top + rect.bottom };
  const toast = mounted.host.querySelector("[role='status']") as HTMLElement;
  const at = toast.getBoundingClientRect();
  expect({
    spans: rect.top < h / 2 && rect.bottom > h / 2,
    clear: at.bottom <= words.top || at.top >= words.bottom,
  }).toEqual({ spans: true, clear: true });
});
