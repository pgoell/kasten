// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { POLICY } from "@/lib/app/csp";
import { blocks } from "./nginx-conf";

const FRONTEND = path.resolve(import.meta.dirname, "..");

const HOST_GATE = /\bif\s*\(\s*\$host\s*!=\s*liste\.pgoell\.com\s*\)\s*\{\s*return\s+404\s*;\s*\}/;

/** Whitespace and a trailing semicolon are spelling, not policy. */
function normalise(policy: string): string {
  return policy
    .split(";")
    .map((directive) => directive.trim().replace(/\s+/g, " "))
    .filter((directive) => directive !== "")
    .join("; ");
}

describe("the lists app's host", () => {
  it("serves the lists app on the share host alone", () => {
    const { locations } = blocks();
    const gated = Object.fromEntries(
      ["= /lists.html", "= /lists.webmanifest", "= /lists-sw.js"].map((key) => [
        key,
        HOST_GATE.test(locations.get(key) ?? ""),
      ]),
    );
    expect(gated).toEqual({
      "= /lists.html": true,
      "= /lists.webmanifest": true,
      "= /lists-sw.js": true,
    });
  });

  it("sends the lists page with the app's policy", () => {
    const body = blocks().locations.get("= /lists.html") ?? "";
    const policy = body.match(/add_header\s+Content-Security-Policy\s+"([^"]*)"/)?.[1] ?? "";
    expect(normalise(policy)).toBe(normalise(POLICY));
  });
});

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
