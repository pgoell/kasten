import "@fontsource-variable/instrument-sans/index.css";
import { fireEvent, render, screen } from "@testing-library/react";
import { commands, page } from "vitest/browser";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare, type Seed } from "../lists-fixture";
import { shot } from "./shots";

// Pictures land in node_modules/.cache/kasten-shots only when asked for, as the chip's are.
const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";

const SEED: Record<string, Seed[]> = {
  Einkauf: [
    { text: "Milch", done: false, assignee: "[[Pascal]]" },
    { text: "Vollkornbrot", done: false, assignee: "[[Alicia]]" },
    { text: "Eier", done: false },
    { text: "Butter", done: false },
    { text: "Haferflocken", done: false, assignee: "[[Pascal]]" },
    { text: "Zitronen", done: false },
    { text: "Bananen", done: true, ticked_by: "Alicia", ticked_at: "2026-10-23T16:04:00Z" },
    { text: "Kaffee", done: true, ticked_by: "Pascal", ticked_at: "2026-10-22T07:30:00Z" },
    { text: "Käse", done: true, ticked_at: "2026-10-21T19:10:00Z" },
  ],
  Todo: [
    { text: "Steuer abgeben", done: false, assignee: "[[Pascal]]" },
    { text: "Paket zur Post", done: false, assignee: "[[Alicia]]" },
    { text: "Kiste reparieren", done: false },
  ],
};

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

interface Look {
  size: { width: number; height: number };
  dark?: boolean;
  touch?: boolean;
  reduced?: boolean;
  /** What the picture shows past the first draw: a list switched, a menu open, a field focused. */
  arrange?: () => void;
}

/** One picture: the app drawn as the look says, saved as `name`, its width checked. */
async function picture(name: string, look: Look): Promise<void> {
  localStorage.clear();
  vi.stubGlobal("fetch", fakeShare(SEED).fetch);
  // A stream that never opens, so the poll draws the list and nothing leaves the page.
  vi.stubGlobal(
    "EventSource",
    class {
      readyState = 0;
      onopen = null;
      onerror = null;
      onmessage = null;
      close() {}
    },
  );
  await page.viewport(look.size.width, look.size.height);
  await commands.emulateMedia({
    touch: look.touch === true,
    reducedMotion: look.reduced ? "reduce" : "no-preference",
  });
  if (look.dark) document.documentElement.setAttribute("data-theme", "dark");
  const { container, unmount } = render(<ListsApp />);
  try {
    await screen.findByRole("checkbox", { name: "Milch" });
    look.arrange?.();
    // The lines and the menu arrive on a transition, so the picture waits for the end state.
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
    await document.fonts.ready;
    expect(await shot(container, name)).toBe(look.size.width);
  } finally {
    unmount();
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
    await commands.emulateMedia({});
    await page.viewport(1280, 900);
  }
}

/** The chip of the row whose words are `text`. */
const chipOf = (text: string) =>
  screen
    .getByRole("checkbox", { name: text })
    .closest(".row")
    ?.querySelector(".chip") as HTMLElement;

/** A picture test that runs only when pictures are asked for. */
function shotTest(name: string, look: Look): void {
  it.skipIf(!SHOTS)(`shot ${name}`, () => picture(name, look), 300_000);
}

const alle = { size: PHONE, touch: true };
const meine = {
  ...alle,
  arrange: () => fireEvent.click(screen.getByRole("button", { name: "Meine" })),
};
const menu = { ...alle, arrange: () => fireEvent.click(chipOf("Eier")) };
const done = {
  ...alle,
  arrange: () => fireEvent.click(screen.getByRole("button", { name: /^Erledigt/ })),
};
const composer = {
  size: { width: 390, height: 500 },
  touch: true,
  arrange: () => screen.getByRole("textbox", { name: "Eintrag" }).focus(),
};

shotTest("lists-phone-alle-light", alle);
shotTest("lists-phone-meine-light", meine);
shotTest("lists-phone-menu-light", menu);
shotTest("lists-phone-done-light", done);
shotTest("lists-phone-composer-light", composer);
shotTest("lists-phone-alle-dark", { ...alle, dark: true });
shotTest("lists-phone-meine-dark", { ...meine, dark: true });
shotTest("lists-phone-menu-dark", { ...menu, dark: true });
shotTest("lists-phone-done-dark", { ...done, dark: true });
shotTest("lists-phone-composer-dark", { ...composer, dark: true });
shotTest("lists-phone-alle-reduced-motion", { ...alle, reduced: true });
shotTest("lists-desktop-light", { size: DESKTOP });
shotTest("lists-desktop-dark", { size: DESKTOP, dark: true });

describe("the shared lists app's rows on screen", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", fakeShare(SEED).fetch);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
    await page.viewport(1280, 900);
  });

  // The colours are the tokens now (#810 A1): the ink, the muted ink, and the surface disc.
  it("open and done rows differ in light", async () => {
    const { open, done } = await drawRows(false);
    expect({
      openText: open.text.color,
      doneStrike: done.text.textDecorationLine,
      doneText: done.text.color,
      openDisc: open.check.backgroundColor,
      openRing: open.check.borderTopWidth,
      doneDisc: done.fill.backgroundColor,
    }).toEqual({
      openText: "rgb(28, 28, 27)",
      doneStrike: "line-through",
      doneText: "rgb(102, 102, 99)",
      openDisc: "rgba(0, 0, 0, 0)",
      openRing: "2px",
      doneDisc: "rgb(235, 235, 232)",
    });
  }, 30_000);

  it("open and done rows differ in dark", async () => {
    const { open, done } = await drawRows(true);
    expect(open.text.color).toBe("rgb(232, 231, 228)");
    expect(done.text.textDecorationLine).toContain("line-through");
    expect(done.text.color).toBe("rgb(154, 153, 149)");
    expect(open.check.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect([open.check.borderTopWidth, done.fill.backgroundColor]).toEqual([
      "2px",
      "rgb(35, 35, 35)",
    ]);
  }, 30_000);
});

/** Draw the app at phone width and read the computed look of the open row Milch and the done row Bananen. */
async function drawRows(dark: boolean) {
  await page.viewport(390, 844);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  render(<ListsApp />);
  await screen.findByRole("checkbox", { name: "Milch" });
  const look = (name: string) => {
    const box = screen.getByRole("checkbox", { name });
    const check = box.querySelector(".check") as HTMLElement;
    return {
      check: getComputedStyle(check),
      fill: getComputedStyle(check, "::before"),
      text: getComputedStyle(box.querySelector(".text") as HTMLElement),
    };
  };
  return { open: look("Milch"), done: look("Bananen") };
}
