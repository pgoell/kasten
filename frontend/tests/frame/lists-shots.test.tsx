import { render, screen } from "@testing-library/react";
import { page } from "vitest/browser";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare } from "../lists-fixture";
import { shot } from "./shots";

const SEED = {
  Einkauf: [
    { text: "Milch", done: false },
    { text: "Vollkornbrot", done: false },
    { text: "Eier", done: true },
    { text: "Zitronen", done: true },
  ],
  Todo: [
    { text: "Steuer abgeben", done: false },
    { text: "Paket zur Post", done: true },
  ],
};

/** Draw the app at a viewport, optionally forced dark, and answer the picture's width. */
async function draw(name: string, width: number, height: number, dark: boolean) {
  await page.viewport(width, height);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  const { container } = render(<ListsApp />);
  await screen.findByRole("checkbox", { name: "Milch" });
  return shot(container, name);
}

describe("the shared lists app on screen", () => {
  beforeEach(() => {
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
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute("data-theme");
    await page.viewport(1280, 900);
  });

  it("saves a phone picture in light", async () => {
    expect(await draw("lists-phone-light", 414, 896, false)).toBe(414);
  }, 30_000);

  it("saves a phone picture in dark", async () => {
    expect(await draw("lists-phone-dark", 414, 896, true)).toBe(414);
  }, 30_000);

  it("saves a desktop picture in light", async () => {
    expect(await draw("lists-desktop-light", 1280, 900, false)).toBe(1280);
  }, 30_000);

  it("open and done rows differ in light", async () => {
    const { open, done } = await drawRows(false);
    expect(open.text.color).toBe("rgb(0, 0, 0)");
    expect(done.text.textDecorationLine).toContain("line-through");
    expect(done.text.color).toBe("rgb(142, 142, 147)");
    expect(open.check.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect([open.check.borderTopWidth, done.check.backgroundColor]).toEqual([
      "2px",
      "rgb(142, 142, 147)",
    ]);
  }, 30_000);

  it("open and done rows differ in dark", async () => {
    const { open, done } = await drawRows(true);
    expect(open.text.color).toBe("rgb(255, 255, 255)");
    expect(done.text.textDecorationLine).toContain("line-through");
    expect(done.text.color).toBe("rgb(142, 142, 147)");
    expect(open.check.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect([open.check.borderTopWidth, done.check.backgroundColor]).toEqual([
      "2px",
      "rgb(142, 142, 147)",
    ]);
  }, 30_000);
});

/** Draw the app at phone width and read the computed look of the open row Milch and the done row Eier. */
async function drawRows(dark: boolean) {
  await page.viewport(414, 896);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  render(<ListsApp />);
  await screen.findByRole("checkbox", { name: "Milch" });
  const look = (name: string) => {
    const box = screen.getByRole("checkbox", { name });
    return {
      check: getComputedStyle(box.querySelector(".check") as HTMLElement),
      text: getComputedStyle(box.querySelector(".text") as HTMLElement),
    };
  };
  return { open: look("Milch"), done: look("Eier") };
}
