/// <reference types="node" />

import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/app.css", "utf8");

test("uses the pgoell families throughout the interface", () => {
  expect(css).toContain('--font-sans: "pgoell Sans Web"');
  expect(css).toContain('--font-mono: "pgoell Mono Web"');
  expect(css).toMatch(/body\s*{[^}]*font-family:\s*var\(--font-sans\)/s);
});

test("sets a note in the proportional face and its code in the monospaced one", () => {
  // A note is prose. Monospace is kept for the two things in it that are code,
  // and for the line numbers, which need a column that does not shuffle.
  expect(css).toMatch(/\.cm-editor \.cm-scroller\s*{[^}]*font-family:\s*var\(--font-sans\)/s);
  expect(css).toMatch(/\.cm-editor \.cm-gutters\s*{[^}]*font-family:\s*var\(--font-mono\)/s);
  expect(css).toMatch(/\.cm-inline-code\s*{[^}]*font-family:\s*var\(--font-mono\)/s);
  expect(css).toMatch(/\.cm-line\.cm-code-block\s*{[^}]*font-family:\s*var\(--font-mono\)/s);
});
