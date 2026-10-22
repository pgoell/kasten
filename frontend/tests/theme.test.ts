import { readFileSync } from "node:fs";
import path from "node:path";
import { paletteEntries } from "@/lib/palette";
import {
  applyTheme,
  onThemeChange,
  PALETTES,
  startTheme,
  THEME_KEY,
  toggleTheme,
} from "@/lib/theme";
import { stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const DARK = "(prefers-color-scheme: dark)";
const REDUCED = "(prefers-reduced-motion: reduce)";
const PALETTE = "kasten.palette";
const POEL = "Accent palette: Vandar Poel's blue";
const RUSSET = "Accent palette: Hay's russet";
const PEACH = "Accent palette: Peach red";

function theme() {
  return document.documentElement.dataset.theme;
}

function palette() {
  return document.documentElement.dataset.palette;
}

/** Runs the palette row called `label`, which does nothing where no such row exists. */
function pickRow(label: string) {
  paletteEntries(stubCommands(), null)
    .find((entry) => entry.label === label)
    ?.run();
}

/** Every read and write of `localStorage` throws, as in a browser with site data blocked. */
function blockStorage() {
  const denied = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
}

/** A browser that offers the view transition, which runs its update at once here. */
function stubViewTransition() {
  const transition = vi.fn((update: () => void) => update());
  Object.defineProperty(document, "startViewTransition", { value: transition, configurable: true });
  return transition;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "startViewTransition");
  document.querySelector('meta[name="theme-color"]')?.remove();
  document.documentElement.style.removeProperty("--k-bg");
});

describe("the theme", () => {
  it("sets data-theme on html from the system with no choice made", () => {
    const system = stubMatchMedia({ [DARK]: true });
    applyTheme();
    const dark = theme();

    system.set(DARK, false);
    applyTheme();

    expect({ dark, light: theme() }).toEqual({ dark: "dark", light: "light" });
  });

  it("the toggle stores the other theme under kasten.theme and applies it", () => {
    stubMatchMedia({});

    toggleTheme();

    expect({ stored: localStorage.getItem(THEME_KEY), shown: theme() }).toEqual({
      stored: "dark",
      shown: "dark",
    });
  });

  it("a stored choice wins over the system", () => {
    stubMatchMedia({ [DARK]: true });
    localStorage.setItem(THEME_KEY, "light");

    applyTheme();

    expect(theme()).toBe("light");
  });

  it("a system change follows live with no choice made, and not with one", () => {
    const system = stubMatchMedia({ [DARK]: false });
    const heard = vi.fn();
    onThemeChange(heard);
    startTheme();

    system.set(DARK, true);
    const followed = theme();
    heard.mockClear();
    localStorage.setItem(THEME_KEY, "light");
    system.set(DARK, false);

    expect({ followed, heardWithChoice: heard.mock.calls.length }).toEqual({
      followed: "dark",
      heardWithChoice: 0,
    });
  });

  it("a switch in another tab applies here", () => {
    stubMatchMedia({});
    startTheme();

    // What the browser does in every tab but the one that wrote.
    localStorage.setItem(THEME_KEY, "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));

    expect(theme()).toBe("dark");
  });

  it("the toggle still switches with storage blocked", () => {
    stubMatchMedia({});
    blockStorage();

    toggleTheme();
    const shown = theme();

    // A write that lands puts the store back in charge, for the tests below
    // as much as for the reader.
    vi.restoreAllMocks();
    toggleTheme();

    expect(shown).toBe("dark");
  });

  it("the toggle cross-fades through a view transition", () => {
    stubMatchMedia({});
    const transition = stubViewTransition();

    toggleTheme();

    expect({ calls: transition.mock.calls.length, shown: theme() }).toEqual({
      calls: 1,
      shown: "dark",
    });
  });

  it("the toggle switches at once under reduced motion", () => {
    stubMatchMedia({ [REDUCED]: true });
    const transition = stubViewTransition();

    toggleTheme();

    expect({ calls: transition.mock.calls.length, shown: theme() }).toEqual({
      calls: 0,
      shown: "dark",
    });
  });

  it("the browser bar takes the page colour on every switch", () => {
    stubMatchMedia({});
    const bar = document.createElement("meta");
    bar.name = "theme-color";
    document.head.append(bar);
    // jsdom loads no stylesheet, so the page colour is set on the element by hand.
    document.documentElement.style.setProperty("--k-bg", "#f6f6f4");
    toggleTheme();
    const first = bar.content;

    document.documentElement.style.setProperty("--k-bg", "#1e2024");
    toggleTheme();

    expect({ first, second: bar.content }).toEqual({ first: "#f6f6f4", second: "#1e2024" });
  });

  it("a listener hears every switch", () => {
    stubMatchMedia({});
    const heard = vi.fn();
    onThemeChange(heard);

    toggleTheme();
    toggleTheme();

    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("the early script reads the same key as the toggle", () => {
    const script = readFileSync(path.resolve(import.meta.dirname, "../public/theme.js"), "utf8");

    expect({ early: script.includes(`"${THEME_KEY}"`), key: THEME_KEY }).toEqual({
      early: true,
      key: "kasten.theme",
    });
  });

  it("the early script sets the browser bar to each theme's page colour", () => {
    const script = readFileSync(path.resolve(import.meta.dirname, "../public/theme.js"), "utf8");
    const css = readFileSync(
      path.resolve(import.meta.dirname, "../src/styles/kasten-theme.css"),
      "utf8",
    );
    const light = /:root\s*\{[^}]*--k-bg:\s*(#\w+)/.exec(css)?.[1];
    const dark = /\[data-theme="dark"\]\s*\{[^}]*--k-bg:\s*(#\w+)/.exec(css)?.[1];
    const early = /const pages = \{ light: "(#\w+)", dark: "(#\w+)" \}/.exec(script);

    expect({ light: early?.[1], dark: early?.[2] }).toEqual({ light, dark });
  });

  it("the browser bar's meta comes before the early script", () => {
    const html = readFileSync(path.resolve(import.meta.dirname, "../index.html"), "utf8");

    // The script runs as it parses, so a meta after it is not there to find.
    expect({
      metaFirst: html.indexOf('name="theme-color"') < html.indexOf('src="/theme.js"'),
    }).toEqual({
      metaFirst: true,
    });
  });

  it("sets data-palette poel on html with nothing chosen", () => {
    stubMatchMedia({});
    applyTheme();

    expect(palette()).toBe("poel");
  });

  it("a stray stored palette reads as poel", () => {
    stubMatchMedia({});
    localStorage.setItem(PALETTE, "neon");

    applyTheme();

    expect(palette()).toBe("poel");
  });

  it("a pick still applies with storage blocked", () => {
    stubMatchMedia({});
    blockStorage();

    pickRow(RUSSET);
    const shown = palette();

    // A write that lands puts the store back in charge, as the toggle test does.
    vi.restoreAllMocks();
    pickRow(POEL);

    expect(shown).toBe("russet");
  });

  it("the early script sets the stored palette, and poel for a stray one", () => {
    stubMatchMedia({});
    const script = readFileSync(path.resolve(import.meta.dirname, "../public/theme.js"), "utf8");
    const run = () => {
      delete document.documentElement.dataset.palette;
      new Function(script)();
      return palette();
    };

    // The literal list, not PALETTES alone: a palette added to theme.ts but not to
    // theme.js would then pass here, so the early script must match the same four.
    const ids = ["poel", "russet", "peach", "pansy"];
    const early = ids.map((id) => {
      localStorage.setItem(PALETTE, id);
      return run();
    });
    localStorage.setItem(PALETTE, "neon");
    const stray = run();

    expect({ ids: PALETTES, early, stray }).toEqual({ ids, early: ids, stray: "poel" });
  });

  it("a theme toggle keeps the palette and a pick keeps the theme", () => {
    stubMatchMedia({});

    pickRow(PEACH);
    toggleTheme();
    const afterToggle = { theme: theme(), palette: palette() };
    pickRow(RUSSET);
    const afterPick = { theme: theme(), palette: palette() };

    expect({ afterToggle, afterPick }).toEqual({
      afterToggle: { theme: "dark", palette: "peach" },
      afterPick: { theme: "dark", palette: "russet" },
    });
  });

  it("a palette picked in another tab applies here", () => {
    stubMatchMedia({});
    startTheme();

    // What the browser does in every tab but the one that wrote.
    localStorage.setItem(PALETTE, "pansy");
    window.dispatchEvent(new StorageEvent("storage", { key: PALETTE }));

    expect(palette()).toBe("pansy");
  });

  it("a listener hears a palette pick", () => {
    stubMatchMedia({});
    const seen: (string | undefined)[] = [];
    const unsubscribe = onThemeChange(() => seen.push(palette()));

    pickRow(RUSSET);
    unsubscribe();

    expect(seen).toEqual(["russet"]);
  });

  it("a pick cross-fades, and not under reduced motion", () => {
    stubMatchMedia({});
    const transition = stubViewTransition();

    pickRow(RUSSET);
    const fade = transition.mock.calls.length;
    const shown = palette();
    stubMatchMedia({ [REDUCED]: true });
    pickRow(PEACH);

    expect({ fade, shown, reduced: transition.mock.calls.length, after: palette() }).toEqual({
      fade: 1,
      shown: "russet",
      reduced: 1,
      after: "peach",
    });
  });
});
