import { readFileSync } from "node:fs";
import path from "node:path";

const FRONTEND = path.resolve(import.meta.dirname, "..");

describe("the lists page", () => {
  it("#810 A1 the theme-colour metas are the page colour token in each scheme", () => {
    const html = readFileSync(path.join(FRONTEND, "lists.html"), "utf8");
    const tokens = readFileSync(path.join(FRONTEND, "src/styles/kasten-theme.css"), "utf8");
    // The light token comes first in the file, the dark one under [data-theme="dark"].
    const [light, dark] = [...tokens.matchAll(/--k-bg:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);

    const meta = (scheme: string) =>
      new RegExp(
        `<meta name="theme-color" content="([^"]+)" media="\\(prefers-color-scheme: ${scheme}\\)"`,
      ).exec(html)?.[1];
    expect({ light: meta("light"), dark: meta("dark") }).toEqual({ light, dark });
  });
});
