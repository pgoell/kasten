/**
 * The palettes as a browser computes them (#778): poel must paint what 0.83.0
 * painted, and each other palette must change only the named tokens.
 *
 * The names come off the token file, so a token added there is checked too.
 */

import { applyTheme } from "@/lib/theme";
import tokenFile from "@/styles/kasten-theme.css?raw";
import "@/styles/app.css";

/** The 19 names a palette block sets. */
const NAMED = [
  "--k-accent",
  "--k-link",
  "--k-accent-wash",
  "--k-highlight",
  "--k-mark",
  "--k-ok",
  "--k-warn",
  "--k-info",
  "--k-danger",
  "--tg-1",
  "--tg-2",
  "--tg-3",
  "--tg-4",
  "--tg-5",
  "--tg-6",
  "--tg-7",
  "--tg-8",
  "--tg-9",
  "--tg-10",
];

const NAMES = [...new Set([...tokenFile.matchAll(/(--[\w-]+):/g)].map((m) => m[1] ?? ""))];

/** Every custom property of the file, as the root element computes it now. */
function computed(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(NAMES.map((name) => [name, style.getPropertyValue(name).trim()]));
}

const root = () => document.documentElement;

afterEach(() => {
  delete root().dataset.palette;
  delete root().dataset.theme;
  localStorage.clear();
});

it("poel computes every token as 0.83.0 did, light and dark", () => {
  localStorage.clear();
  applyTheme();
  const palette = root().dataset.palette;
  const same: Record<string, boolean> = {};
  for (const theme of ["light", "dark"] as const) {
    root().dataset.theme = theme;
    const withAttribute = computed();
    delete root().dataset.palette;
    const withoutAttribute = computed();
    if (palette !== undefined) root().dataset.palette = palette;
    same[theme] = JSON.stringify(withAttribute) === JSON.stringify(withoutAttribute);
  }
  expect({ palette, light: same.light, dark: same.dark }).toEqual({
    palette: "poel",
    light: true,
    dark: true,
  });
});

it("the tokens that differ from poel are exactly the named set, per palette and theme", () => {
  const cases: Record<string, { outside: string[]; differs: boolean }> = {};
  for (const theme of ["light", "dark"] as const) {
    root().dataset.theme = theme;
    root().dataset.palette = "poel";
    const poel = computed();
    for (const palette of ["russet", "peach", "pansy"]) {
      root().dataset.palette = palette;
      const values = computed();
      const differs = NAMES.filter((name) => values[name] !== poel[name]);
      cases[`${palette} ${theme}`] = {
        outside: differs.filter((name) => !NAMED.includes(name)),
        differs: differs.length > 0,
      };
    }
  }
  expect(cases).toEqual({
    "russet light": { outside: [], differs: true },
    "russet dark": { outside: [], differs: true },
    "peach light": { outside: [], differs: true },
    "peach dark": { outside: [], differs: true },
    "pansy light": { outside: [], differs: true },
    "pansy dark": { outside: [], differs: true },
  });
});
