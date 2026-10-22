/// <reference types="node" />

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Comments are cut before any rule is read, so a word in a comment cannot
// stand in for a declaration.
const app = readFileSync("src/styles/app.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = readFileSync("src/styles/kasten-theme.css", "utf8");

/**
 * The text of the top-level block that opens with `header`, up to its closing
 * brace. Empty when there is no such block, so the expectation on it fails as
 * an assertion and names what is missing.
 */
function block(header: string): string {
  const start = app.indexOf(header);
  if (start < 0) return "";
  return app.slice(start + header.length, app.indexOf("\n}", start));
}

const SIZES: [size: number, leading: string, track: string][] = [
  [12, "ui", "label"],
  [13, "ui", "label"],
  [15, "ui", "body"],
  [19, "reading", "body"],
  [23, "heading", "heading"],
  [27, "title", "title"],
  [36, "title", "title"],
  [46, "display", "display"],
  [64, "display", "display"],
];

function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((entry) => join(dir, entry))
    .filter((file) => /\.(css|ts|tsx)$/.test(file));
}

describe("the press feedback", () => {
  it("a pressed control scales by the press token, quick going in", () => {
    const pressed = block("[data-pressed]:not(.k-row) {");

    expect(pressed).toContain("transform: scale(var(--k-press-scale))");
    expect(pressed).toContain("transition-duration: var(--k-press-in)");
  });

  it("every control eases back on the press-out time and the ease-out curve", () => {
    const base = block(":where(button, [role=button], [role=tab], a[href], summary) {");

    expect(base).toContain("transition: transform var(--k-press-out) var(--k-ease-out)");
  });

  it("a row tints under the press and is never scaled", () => {
    const row = block(".k-row[data-pressed] {");

    expect(row).toContain("background-color: var(--k-surface)");
    expect(row).not.toContain("transform");
  });

  it("touch-action is manipulation on every control", () => {
    const selector = /([^{}]+)\{\s*touch-action: manipulation;/.exec(app)?.[1] ?? "";

    expect(selector.split(",").map((part) => part.trim())).toEqual([
      "button",
      "[role=button]",
      "[role=tab]",
      "a[href]",
      "summary",
      "label",
      "input",
      "select",
      "textarea",
    ]);
  });

  it("the sheet's drag handle is touch-action none, which outranks the list", () => {
    expect(block("[data-sheet-drag] {")).toContain("touch-action: none");
  });

  it("reduced motion takes the press scale off", () => {
    expect(block("@media (prefers-reduced-motion: reduce) {")).toContain("transform: none");
  });
});

describe("the glass material", () => {
  it("k-glass is the page colour at 84 per cent over a blur", () => {
    const glass = block("@utility k-glass {");

    expect(glass).toContain("background-color: color-mix(in srgb, var(--k-bg) 84%, transparent)");
    expect(glass).toContain("backdrop-filter: blur(18px) saturate(1.4)");
  });

  it("the hairline is drawn in the rule colour", () => {
    expect(block("@utility k-hairline {")).toContain("border-bottom: 1px solid var(--k-rule)");
  });

  it("reduced transparency makes the glass solid and drops the blur", () => {
    const media = block("@media (prefers-reduced-transparency: reduce) {");

    expect(media).toContain(".k-glass");
    expect(media).toContain("background-color: var(--k-bg)");
    expect(media).toContain("backdrop-filter: none");
  });

  it("more contrast makes the glass solid and drops the blur", () => {
    const media = block("@media (prefers-contrast: more) {");

    expect(media).toContain(".k-glass");
    expect(media).toContain("background-color: var(--k-bg)");
    expect(media).toContain("backdrop-filter: none");
  });

  it("more contrast draws k-hairline in var(--k-ink)", () => {
    expect(block("@media (prefers-contrast: more) {")).toContain(
      ".k-hairline {\n    border-bottom-color: var(--k-ink);",
    );
  });

  it("nothing else in the styles or components blurs what is behind it", () => {
    const hits = [...filesUnder("src/styles"), ...filesUnder("src/components")]
      .filter((file) => !/(app|lists)\.css$/.test(file))
      .filter((file) => /backdrop-(filter|blur)/.test(readFileSync(file, "utf8")));

    expect(hits).toEqual([]);
  });

  it("the route's main clips sideways overflow rather than hiding it", () => {
    const route = readFileSync("src/routes/index.tsx", "utf8");
    const main = /<main [^>]*>/.exec(route)?.[0] ?? "";

    expect(main).toMatch(/\boverflow-x-clip\b/);
    expect(main).not.toMatch(/\boverflow-x-hidden\b/);
  });
});

describe("the list entrance and the type sizes", () => {
  it("k-enter staggers by index up to the cap, on opacity and transform only", () => {
    const enter = block(".k-enter {");

    expect(enter).toContain("animation: k-enter 240ms var(--k-ease-out) both");
    expect(enter).toContain(
      "animation-delay: calc(min(var(--i, 0), var(--k-stagger-cap)) * var(--k-stagger))",
    );
    const frames = block("@keyframes k-enter {");
    expect(frames).toContain("opacity: 0");
    expect(frames).toContain("transform: translateY(6px)");
    expect(frames).not.toMatch(/width|height|top|left|margin|padding/);
  });

  it("reduced motion drops the entrance", () => {
    expect(block("@media (prefers-reduced-motion: reduce) {")).toContain(
      ".k-enter {\n    animation: none;",
    );
  });

  it("each text-k size carries its leading and tracking, and kbd and label carry tracking", () => {
    const entries = [
      ...SIZES.flatMap(([size, leading, track]) => [
        `--text-k-${size}: var(--k-text-${size});`,
        `--text-k-${size}--line-height: var(--k-leading-${leading});`,
        `--text-k-${size}--letter-spacing: var(--k-track-${track});`,
      ]),
      "--tracking-k-kbd: var(--k-track-kbd);",
      "--tracking-k-label: var(--k-track-label);",
    ];

    expect(entries.filter((entry) => !app.includes(entry))).toEqual([]);
  });

  it("the display pair is in the token file", () => {
    expect(tokens).toContain("--k-leading-display: 1.04;");
    expect(tokens).toContain("--k-track-display: -0.018em;");
  });
});
