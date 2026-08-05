/// <reference types="node" />

import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/app.css", "utf8");

test("uses the pgoell families throughout the interface", () => {
  expect(css).toContain('--font-sans: "pgoell Sans Web"');
  expect(css).toContain('--font-mono: "pgoell Mono Web"');
  expect(css).toMatch(/body\s*{[^}]*font-family:\s*var\(--font-sans\)/s);
  expect(css).toMatch(/\.cm-editor \.cm-scroller\s*{[^}]*font-family:\s*var\(--font-mono\)/s);
});
