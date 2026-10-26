/**
 * The assignee chip in a real browser (#809): a tap and a click open the person
 * note, the keys still open a todo's note, and the chip sheds its transition under
 * reduced motion. Touch and mouse are sent through the DevTools protocol, as the
 * other frame tests send them.
 */

import { commands, page } from "vitest/browser";
import { DEFAULT_VIEWS } from "@/lib/todo-view";
import {
  chipNamed,
  click,
  cursorKey,
  DAILY,
  FILES,
  HITS,
  mount,
  PASCAL,
  PEOPLE,
  press,
  tap,
} from "./person-chip-fixture";

const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchTodos,
  fetchNote,
  fetchFiles,
  createNote,
}));

beforeEach(() => {
  fetchTodos.mockResolvedValue(HITS);
  fetchFiles.mockResolvedValue(FILES);
  fetchNote.mockImplementation(async (path: string) => PEOPLE[path] ?? DEFAULT_VIEWS);
  createNote.mockResolvedValue(undefined);
});

afterEach(async () => {
  // The next test in this browser page would still read the touch and motion set here.
  await commands.emulateMedia({});
  await page.viewport(1440, 900);
});

describe("the assignee chip in a browser (#809)", () => {
  it("#809 A9 at 390x844 by touch a tap on the chip opens the person note and nothing scrolls sideways", async () => {
    await commands.emulateMedia({ touch: true });
    const pane = await mount(390, 844, { coarse: true });
    try {
      const chip = chipNamed(pane.host, "Pascal");
      // I7: the tap box is at least 44 px tall on touch. The row's entrance slide moves
      // getBoundingClientRect off the laid-out box by a float step, so read the layout.
      expect(parseFloat(getComputedStyle(chip).height)).toBeGreaterThanOrEqual(44);

      await tap(chip);

      await expect.poll(() => pane.onOpen.mock.calls.length).toBe(1);
      expect(pane.onOpen).toHaveBeenCalledWith(PASCAL, 1);
      expect(pane.onCycle).not.toHaveBeenCalled();
      // Neither the state button nor the `⋯` strip is open after the tap.
      expect(pane.host.querySelector("[aria-pressed='true'][aria-label^='cycle']")).toBeNull();
      expect(pane.host.querySelector("[aria-expanded='true']")).toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    } finally {
      pane.unmount();
    }
  });

  it("#1145 A4 with its row held mid-entrance the chip's tap box still measures at least 44 px", async () => {
    await commands.emulateMedia({ touch: true });
    const pane = await mount(390, 844, { coarse: true });
    const held: Animation[] = [];
    try {
      const chip = chipNamed(pane.host, "Pascal");
      // Held at 180 ms, where the slide's float32 transform takes the box to 43.99997 px.
      for (const animation of document.getAnimations()) {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        if (!(target instanceof Element) || !pane.host.contains(target)) continue;
        animation.pause();
        animation.currentTime = 180;
        held.push(animation);
      }
      expect(held.length).toBeGreaterThan(0);
      expect(parseFloat(getComputedStyle(chip).height)).toBeGreaterThanOrEqual(44);
    } finally {
      for (const animation of held) animation.cancel();
      pane.unmount();
    }
  });

  it("#809 A9 at 1440x900 a mouse click on a board card's chip opens the person note, and j and Enter on the row still open the todo's note", async () => {
    const pane = await mount(1440, 900, { board: true });
    try {
      const card = [...pane.host.querySelectorAll<HTMLElement>("[data-testid='todo-card']")].find(
        (one) => one.textContent?.includes("buy paint"),
      ) as HTMLElement;
      await click(chipNamed(card, "Pascal"));

      await expect.poll(() => pane.onOpen.mock.calls.length).toBe(1);
      expect(pane.onOpen).toHaveBeenCalledWith(PASCAL, 1);

      // Back to the list, where the keys open a todo's own note, not a person's.
      press(pane.host, "c");
      await expect.poll(() => cursorKey(pane.host)).not.toBe("");
      const before = cursorKey(pane.host);
      press(pane.host, "j");
      await expect.poll(() => cursorKey(pane.host)).not.toBe(before);
      const after = cursorKey(pane.host);
      press(pane.host, "Enter");

      expect(pane.onOpen).toHaveBeenCalledTimes(2);
      expect(pane.onOpen).toHaveBeenLastCalledWith(
        DAILY,
        Number(after.slice(after.lastIndexOf(":") + 1)),
      );
      expect(pane.onOpen).not.toHaveBeenLastCalledWith(PASCAL, 1);
    } finally {
      pane.unmount();
    }
  });

  it("#809 A9 with reduced motion the chip has no transition", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const pane = await mount(1440, 900);
    try {
      // The pill inside the chip is the part that changes colour, so it is the one to read.
      const pill = chipNamed(pane.host, "Pascal").firstElementChild as HTMLElement;
      expect(getComputedStyle(pill).transitionDuration).toBe("0s");
    } finally {
      pane.unmount();
    }
  });
});
