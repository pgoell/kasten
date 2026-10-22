/// <reference types="node" />

import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/kasten-theme.css", "utf8");

// Declarations of one block, by name. Tokens hold no braces, so the first
// closing brace ends the block.
function declarations(block: RegExp): Record<string, string> {
  const match = block.exec(css);
  if (!match) throw new Error(`no block matches ${block}`);
  return Object.fromEntries(
    [...(match[1] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] ?? "",
      (m[2] ?? "").trim(),
    ]),
  );
}

const light = declarations(/:root\s*{([^}]*)}/);
const dark = declarations(/\[data-theme="dark"\]\s*{([^}]*)}/);

test("the token file holds every light token of #777", () => {
  const expected = {
    "--k-bg": "#f6f6f4",
    "--k-paper": "#fbfbfa",
    "--k-surface": "#ebebe8",
    "--k-ink": "#1c1c1b",
    "--k-ink-soft": "#3b3b39",
    "--k-muted": "#666663",
    "--k-rule": "#e1e1de",
    "--k-rule-strong": "#1c1c1b",
    "--k-inset": "rgba(28,28,27,.06)",
    "--k-accent": "#316f90",
    "--k-link": "#316f90",
    "--k-accent-wash": "rgba(49,111,144,.11)",
    "--k-highlight": "rgba(249,157,27,.22)",
    "--k-mark": "rgba(249,157,27,.22)",
    "--k-ok": "#247b4b",
    "--k-warn": "#8d5e09",
    "--k-info": "#4a6d89",
    "--k-danger": "#9a5143",
    "--k-shadow": "0 1px 2px rgba(0,0,0,.05),0 12px 32px rgba(0,0,0,.09)",
    "--tg-1": "#b05459",
    "--tg-2": "#5b8230",
    "--tg-3": "#307baf",
    "--tg-4": "#9c5a8d",
    "--tg-5": "#7f7800",
    "--tg-6": "#0f848a",
    "--tg-7": "#8a639a",
    "--tg-8": "#a66218",
    "--tg-9": "#338756",
    "--tg-10": "#7567b1",
    "--tg-none": "#9b9b99",
  };
  expect(Object.fromEntries(Object.keys(expected).map((name) => [name, light[name]]))).toEqual(
    expected,
  );
});

test("the token file holds every dark token of #777", () => {
  const expected = {
    "--k-bg": "#141414",
    "--k-paper": "#1a1a1a",
    "--k-surface": "#232323",
    "--k-ink": "#e8e7e4",
    "--k-ink-soft": "#c6c5c1",
    "--k-muted": "#9a9995",
    "--k-rule": "#2c2c2c",
    "--k-rule-strong": "#e8e7e4",
    "--k-inset": "rgba(232,231,228,.08)",
    "--k-accent": "#82b9d9",
    "--k-link": "#82b9d9",
    "--k-accent-wash": "rgba(130,185,217,.14)",
    "--k-highlight": "rgba(167,212,228,.18)",
    "--k-mark": "rgba(167,212,228,.18)",
    "--k-ok": "#7acd97",
    "--k-warn": "#e7aa53",
    "--k-info": "#97bddb",
    "--k-danger": "#f19f8f",
    "--k-shadow": "0 1px 2px rgba(0,0,0,.3),0 16px 40px rgba(0,0,0,.45)",
    "--tg-1": "#ea9799",
    "--tg-2": "#9bbe7b",
    "--tg-3": "#76b9ec",
    "--tg-4": "#da99c9",
    "--tg-5": "#bab567",
    "--tg-6": "#56c4ca",
    "--tg-7": "#c99fda",
    "--tg-8": "#dfa26d",
    "--tg-9": "#7cc495",
    "--tg-10": "#b1a6ec",
    "--tg-none": "#878783",
  };
  expect(Object.fromEntries(Object.keys(expected).map((name) => [name, dark[name]]))).toEqual(
    expected,
  );
});

test("the token file holds the type, space and motion tokens", () => {
  const expected = {
    "--k-serif": '"Newsreader Variable", Georgia, serif',
    "--k-sans": '"Instrument Sans Variable", system-ui, sans-serif',
    "--k-mono": '"JetBrains Mono Variable", ui-monospace, monospace',
    "--k-text-12": "12px",
    "--k-text-13": "13px",
    "--k-text-15": "15px",
    "--k-text-19": "19px",
    "--k-text-23": "23px",
    "--k-text-27": "27px",
    "--k-text-36": "36px",
    "--k-text-46": "46px",
    "--k-text-64": "64px",
    "--k-leading-title": "1.1",
    "--k-leading-heading": "1.1",
    "--k-leading-ui": "1.5",
    "--k-leading-reading": "1.6",
    "--k-space-4": "4px",
    "--k-space-8": "8px",
    "--k-space-12": "12px",
    "--k-space-16": "16px",
    "--k-space-24": "24px",
    "--k-space-32": "32px",
    "--k-space-48": "48px",
    "--k-space-64": "64px",
    "--k-radius-4": "4px",
    "--k-radius-6": "6px",
    "--k-radius-8": "8px",
    "--k-measure": "680px",
    "--k-press-scale": "0.97",
    "--k-press-in": "100ms",
    "--k-press-out": "160ms",
    "--k-hover": "150ms",
    "--k-ease-out": "cubic-bezier(0.23, 1, 0.32, 1)",
    "--k-spring-response": "0.32s",
    "--k-spring-damping": "1",
    "--k-spring-flick-damping": "0.8",
    "--k-spring-sheet-open": "0.35s",
    "--k-spring-sheet-close": "0.3s",
    "--k-spring-tab": "0.32s",
    "--k-spring-split": "0.34s",
    "--k-spring-card": "0.26s",
    "--k-stagger": "22ms",
    "--k-stagger-cap": "6",
    "--k-theme-fade": "240ms",
    "--k-track-title": "-0.017em",
    "--k-track-heading": "-0.016em",
    "--k-track-body": "0em",
    "--k-track-label": "0.006em",
    "--k-track-kbd": "0.02em",
  };
  expect(Object.fromEntries(Object.keys(expected).map((name) => [name, light[name]]))).toEqual(
    expected,
  );
});

test("the theme switch cross-fades, and not under reduced motion", () => {
  const fade = /::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*{([^}]*)}/.exec(
    css,
  );
  const reduced =
    /@media \(prefers-reduced-motion: reduce\)\s*{[\s\S]*?::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*{([^}]*)}/.exec(
      css,
    );

  expect(fade?.[1]).toContain("animation-duration: var(--k-theme-fade)");
  expect(reduced?.[1]).toContain("animation: none");
});
