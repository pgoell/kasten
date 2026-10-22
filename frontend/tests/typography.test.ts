/// <reference types="node" />

import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/app.css", "utf8");

test("maps the tailwind families onto the kasten families", () => {
  expect(css).toContain("--font-sans: var(--k-sans)");
  expect(css).toContain("--font-serif: var(--k-serif)");
  expect(css).toContain("--font-mono: var(--k-mono)");
  expect(css).toMatch(/body\s*{[^}]*font-family:\s*var\(--font-sans\)/s);
});

test("names the three families with their fallbacks in the token file", () => {
  const theme = readFileSync("src/styles/kasten-theme.css", "utf8");
  expect(theme).toContain('--k-serif: "Newsreader Variable", Georgia, serif');
  expect(theme).toContain('--k-sans: "Instrument Sans Variable", system-ui, sans-serif');
  expect(theme).toContain('--k-mono: "JetBrains Mono Variable", ui-monospace, monospace');
});

test("sets a note in the proportional face and its code in the monospaced one", () => {
  // A note is prose. Monospace is kept for the two things in it that are code,
  // and for the line numbers, which need a column that does not shuffle.
  expect(css).toMatch(/\.cm-editor \.cm-scroller\s*{[^}]*font-family:\s*var\(--font-sans\)/s);
  expect(css).toMatch(/\.cm-editor \.cm-gutters\s*{[^}]*font-family:\s*var\(--font-mono\)/s);
  expect(css).toMatch(/\.cm-inline-code\s*{[^}]*font-family:\s*var\(--font-mono\)/s);
  expect(css).toMatch(/\.cm-line\.cm-code-block\s*{[^}]*font-family:\s*var\(--font-mono\)/s);
});
