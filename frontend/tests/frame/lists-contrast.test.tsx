import { cleanup, render, screen } from "@testing-library/react";
import { page } from "vitest/browser";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare } from "../lists-fixture";

const SEED = {
  Einkauf: [
    { text: "Milch", done: false, assignee: "[[Pascal]]" },
    { text: "Vollkornbrot", done: false },
    { text: "Eier", done: true, ticked_by: "Alicia" },
    { text: "Zitronen", done: true },
  ],
  Todo: [
    { text: "Steuer abgeben", done: false },
    { text: "Paket zur Post", done: true },
  ],
};

type Rgba = [number, number, number, number];

/** Read a computed rgb() or rgba() string. */
function parse(css: string): Rgba {
  const match = css.match(/rgba?\(([^)]+)\)/);
  if (!match) throw new Error(`not a colour: ${css}`);
  const [r = 0, g = 0, b = 0, a = 1] = (match[1] ?? "")
    .split(",")
    .map((part) => Number.parseFloat(part));
  return [r, g, b, a];
}

/** A translucent colour as the screen shows it, laid over an opaque base. */
function solid(top: string, base: Rgba): Rgba {
  const [r, g, b, a] = parse(top);
  return [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a), 1];
}

/** WCAG relative luminance of an opaque colour. */
function luminance([r, g, b]: Rgba): number {
  const [R = 0, G = 0, B = 0] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio of two opaque colours. */
function ratio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** "ok" when the ratio meets the minimum, else the ratio, so a failure shows the number. */
function grade(r: number, min: number): string {
  return r >= min ? "ok" : r.toFixed(2);
}

/** Draw the app at phone width, optionally forced dark, and wait for the list. */
async function draw(dark: boolean): Promise<void> {
  await page.viewport(414, 896);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  render(<ListsApp />);
  await screen.findByRole("checkbox", { name: "Milch" });
}

/** The colour a bare element sits on. */
function bodyColor(): Rgba {
  return parse(getComputedStyle(document.body).backgroundColor);
}

describe("the lists app contrast", () => {
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
    document.documentElement.removeAttribute("data-palette");
    await page.viewport(1280, 900);
  });

  it("the chosen list stands out from its track at 3:1", async () => {
    const measure = async (dark: boolean) => {
      await draw(dark);
      const segment = document.querySelector(".segment") as HTMLElement;
      const chosen = segment.querySelector('[aria-pressed="true"]') as HTMLElement;
      const other = segment.querySelector('[aria-pressed="false"]') as HTMLElement;
      const track = solid(getComputedStyle(segment).backgroundColor, bodyColor());
      const thumb = parse(getComputedStyle(chosen).backgroundColor);
      const result = {
        thumb: grade(ratio(thumb, track), 3),
        chosenLabel: grade(ratio(parse(getComputedStyle(chosen).color), thumb), 4.5),
        otherLabel: grade(ratio(parse(getComputedStyle(other).color), track), 4.5),
      };
      cleanup();
      return result;
    };
    const light = await measure(false);
    const dark = await measure(true);
    expect({ light, dark }).toEqual({
      light: { thumb: "ok", chosenLabel: "ok", otherLabel: "ok" },
      dark: { thumb: "ok", chosenLabel: "ok", otherLabel: "ok" },
    });
  }, 30_000);

  it("done text reads at 4.5:1 on its card", async () => {
    const measure = async (dark: boolean) => {
      await draw(dark);
      const eier = screen.getByRole("checkbox", { name: "Eier" });
      const milch = screen.getByRole("checkbox", { name: "Milch" });
      const card = parse(getComputedStyle(eier.closest(".group") as HTMLElement).backgroundColor);
      // The disc is the fill behind the tick (#810 A1), so it is the pseudo-element that is measured.
      const disc = parse(
        getComputedStyle(eier.querySelector(".check") as HTMLElement, "::before").backgroundColor,
      );
      const ring = parse(
        getComputedStyle(milch.querySelector(".check") as HTMLElement).borderTopColor,
      );
      const text = parse(getComputedStyle(eier.querySelector(".text") as HTMLElement).color);
      const tick = parse(
        getComputedStyle(eier.querySelector(".check") as HTMLElement, "::after").borderBottomColor,
      );
      // The disc is the surface, which sits near the card in tone on purpose (#810 A1). The
      // state is the ink tick on it, and the ring around it, which are the 3:1 pairs.
      const result = {
        text: grade(ratio(text, card), 4.5),
        ring: grade(ratio(ring, card), 3),
        tick: grade(ratio(tick, disc), 3),
      };
      cleanup();
      return result;
    };
    const light = await measure(false);
    const dark = await measure(true);
    expect({ light, dark }).toEqual({
      light: { text: "ok", ring: "ok", tick: "ok" },
      dark: { text: "ok", ring: "ok", tick: "ok" },
    });
  }, 30_000);

  it("the Erledigt heading reads at 4.5:1 on the page", async () => {
    const measure = async (dark: boolean) => {
      await draw(dark);
      const head = document.querySelector(".group-head") as HTMLElement;
      const count = head.querySelector(".count") as HTMLElement;
      const result = {
        heading: grade(ratio(parse(getComputedStyle(head).color), bodyColor()), 4.5),
        count: grade(ratio(parse(getComputedStyle(count).color), bodyColor()), 4.5),
      };
      cleanup();
      return result;
    };
    const light = await measure(false);
    const dark = await measure(true);
    expect({ light, dark }).toEqual({
      light: { heading: "ok", count: "ok" },
      dark: { heading: "ok", count: "ok" },
    });
  }, 30_000);

  it("#810 A5 the chip reads at 4.5:1 linked and unlinked in every palette and both schemes", async () => {
    const result = await everyLook(() => {
      const linked = need(".chip.linked .chip-name");
      const unlinked = need(".chip.unlinked .chip-name");
      const card = parse(
        getComputedStyle(unlinked.closest(".group") as HTMLElement).backgroundColor,
      );
      return {
        linked: grade(
          ratio(
            parse(getComputedStyle(linked).color),
            parse(getComputedStyle(linked).backgroundColor),
          ),
          4.5,
        ),
        unlinked: grade(ratio(parse(getComputedStyle(unlinked).color), card), 4.5),
      };
    });
    expect(result).toEqual(allOk(["linked", "unlinked"]));
  }, 60_000);

  it("#810 A7 the abgehakt line reads at 4.5:1 on its card in every palette and both schemes", async () => {
    const result = await everyLook(() => {
      const line = need(".by");
      const card = parse(getComputedStyle(line.closest(".group") as HTMLElement).backgroundColor);
      return { line: grade(ratio(parse(getComputedStyle(line).color), card), 4.5) };
    });
    expect(result).toEqual(allOk(["line"]));
  }, 60_000);

  it("#810 A3 the counts and the chosen list read in every palette and both schemes", async () => {
    const result = await everyLook(() => {
      const segment = document.querySelector(".segment") as HTMLElement;
      const chosen = segment.querySelector('[aria-pressed="true"]') as HTMLElement;
      const track = parse(getComputedStyle(segment).backgroundColor);
      const thumb = parse(getComputedStyle(chosen).backgroundColor);
      return {
        chosenCount: grade(
          ratio(
            parse(getComputedStyle(need('.segment [aria-pressed="true"] .count')).color),
            thumb,
          ),
          4.5,
        ),
        otherCount: grade(
          ratio(
            parse(getComputedStyle(need('.segment [aria-pressed="false"] .count')).color),
            track,
          ),
          4.5,
        ),
        thumb: grade(ratio(thumb, track), 3),
      };
    });
    expect(result).toEqual(allOk(["chosenCount", "otherCount", "thumb"]));
  }, 60_000);

  it("#810 A8 Hinzufügen reads at 4.5:1 on its accent in every palette and both schemes", async () => {
    const result = await everyLook(() => {
      const add = need(".add");
      return {
        add: grade(
          ratio(parse(getComputedStyle(add).color), parse(getComputedStyle(add).backgroundColor)),
          4.5,
        ),
      };
    });
    expect(result).toEqual(allOk(["add"]));
  }, 60_000);

  /** The element a look is read from. Missing, the test says which one, not a null read. */
  function need(selector: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`no ${selector} on the page`);
    return found;
  }

  /** Draws the app in one palette and scheme, as a palette and the phone's scheme set them. */
  async function drawLook(palette: string, dark: boolean): Promise<void> {
    document.documentElement.setAttribute("data-palette", palette);
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    render(<ListsApp />);
    await screen.findByRole("checkbox", { name: "Milch" });
  }

  /** Every palette in both schemes, read by `measure`, each look keyed by its name. */
  async function everyLook(measure: () => Record<string, string>) {
    const looks: Record<string, Record<string, string>> = {};
    for (const palette of ["poel", "russet", "peach", "pansy"]) {
      for (const dark of [false, true]) {
        await drawLook(palette, dark);
        looks[`${palette}${dark ? " dark" : " light"}`] = measure();
        cleanup();
      }
    }
    return looks;
  }

  /** The expected answer for every look: each named pairing reads "ok" in all eight. */
  function allOk(names: string[]) {
    const one = Object.fromEntries(names.map((name) => [name, "ok"]));
    return Object.fromEntries(
      ["poel", "russet", "peach", "pansy"].flatMap((palette) =>
        ["light", "dark"].map((scheme) => [`${palette} ${scheme}`, one]),
      ),
    );
  }
});
