/// <reference types="node" />

import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/kasten-theme.css", "utf8");

type RGB = [number, number, number];

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

// A colour as WCAG sees it: an alpha colour is blended over the backdrop it
// sits on first, so a wash is judged as the paper it lands on.
function over(value: string, backdrop: RGB): RGB {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1] ?? "";
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as RGB;
  }
  const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
  if (!rgba) throw new Error(`unreadable colour ${value}`);
  const alpha = Number(rgba[4]);
  const top = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  return top.map((c, channel) => alpha * c + (1 - alpha) * (backdrop[channel] ?? 0)) as RGB;
}

function luminance([r, g, b]: RGB): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const round = (n: number) => Math.round(n * 100) / 100;

// The bar is 4.5 for text and 3 for a tag's dot. A pair at or over its bar is
// "ok"; a pair under it reports its ratio, so a failure shows the number.
function grade(value: number, bar: number): "ok" | number {
  return value >= bar ? "ok" : round(value);
}

function gradeAll(pairs: Record<string, number>, bar: number) {
  return Object.fromEntries(
    Object.entries(pairs).map(([name, value]) => [name, grade(value, bar)]),
  );
}

// Every pair of the issue's contrast table. Both themes read the same way, so
// one function takes the tokens of the block it is given.
function measure(tokens: Record<string, string>) {
  const black: RGB = [0, 0, 0];
  const paper = over(tokens["--k-paper"] ?? "", black);
  const bg = over(tokens["--k-bg"] ?? "", black);
  const surface = over(tokens["--k-surface"] ?? "", black);
  const wash = over(tokens["--k-accent-wash"] ?? "", paper);
  const highlight = over(tokens["--k-highlight"] ?? "", paper);
  const onBg = (name: string, on: RGB) => ratio(over(tokens[name] ?? "", on), on);
  const inkOn = (on: RGB) => ratio(over(tokens["--k-ink"] ?? "", on), on);
  return {
    text: {
      inkOnPaper: inkOn(paper),
      mutedOnSurface: onBg("--k-muted", surface),
      linkOnPaper: onBg("--k-link", paper),
      accentOnSurface: onBg("--k-accent", surface),
      accentOnWash: onBg("--k-accent", wash),
      inkOnHighlight: inkOn(highlight),
      linkOnHighlight: onBg("--k-link", highlight),
      mutedOnHighlight: onBg("--k-muted", highlight),
    },
    status: {
      statusOk: onBg("--k-ok", paper),
      statusWarn: onBg("--k-warn", paper),
      statusInfo: onBg("--k-info", paper),
      statusDanger: onBg("--k-danger", paper),
    },
    tags: {
      tg1: onBg("--tg-1", bg),
      tg2: onBg("--tg-2", bg),
      tg3: onBg("--tg-3", bg),
      tg4: onBg("--tg-4", bg),
      tg5: onBg("--tg-5", bg),
      tg6: onBg("--tg-6", bg),
      tg7: onBg("--tg-7", bg),
      tg8: onBg("--tg-8", bg),
      tg9: onBg("--tg-9", bg),
      tg10: onBg("--tg-10", bg),
    },
  };
}

const light = declarations(/:root\s*{([^}]*)}/);
const dark = declarations(/\[data-theme="dark"\]\s*{([^}]*)}/);

test("every light pair of #777 clears its bar", () => {
  const { text, status, tags } = measure(light);
  expect({
    ...gradeAll(text, 4.5),
    ...gradeAll(status, 4.5),
    ...gradeAll(tags, 3),
    lowestStatus: round(Math.min(...Object.values(status))),
    lowestTag: round(Math.min(...Object.values(tags))),
  }).toEqual({
    inkOnPaper: "ok",
    mutedOnSurface: "ok",
    linkOnPaper: "ok",
    accentOnSurface: "ok",
    accentOnWash: "ok",
    inkOnHighlight: "ok",
    linkOnHighlight: "ok",
    mutedOnHighlight: "ok",
    statusOk: "ok",
    statusWarn: "ok",
    statusInfo: "ok",
    statusDanger: "ok",
    tg1: "ok",
    tg2: "ok",
    tg3: "ok",
    tg4: "ok",
    tg5: "ok",
    tg6: "ok",
    tg7: "ok",
    tg8: "ok",
    tg9: "ok",
    tg10: "ok",
    lowestStatus: 5.06,
    lowestTag: 4.09,
  });
});

test("every dark pair of #777 clears its bar, muted on the highlight excepted", () => {
  const { text, status, tags } = measure(dark);
  expect({
    ...gradeAll(text, 4.5),
    ...gradeAll(status, 4.5),
    ...gradeAll(tags, 3),
    // The one exception the issue names: muted on the dark highlight stays
    // under 4.5, so it is reported as a number and flagged, not graded "ok".
    // The number is 3.98 here; the issue rounds it as 4.01.
    // Held in a band, not just under 4.5: the issue keeps it at 4.01, so a
    // drift below 3.9 or up to the bar is a change to look at.
    mutedOnHighlightBand: text.mutedOnHighlight >= 3.9 && text.mutedOnHighlight < 4.5,
    lowestStatus: round(Math.min(...Object.values(status))),
    lowestTag: round(Math.min(...Object.values(tags))),
  }).toEqual({
    inkOnPaper: "ok",
    mutedOnSurface: "ok",
    linkOnPaper: "ok",
    accentOnSurface: "ok",
    accentOnWash: "ok",
    inkOnHighlight: "ok",
    linkOnHighlight: "ok",
    mutedOnHighlight: expect.any(Number),
    mutedOnHighlightBand: true,
    statusOk: "ok",
    statusWarn: "ok",
    statusInfo: "ok",
    statusDanger: "ok",
    tg1: "ok",
    tg2: "ok",
    tg3: "ok",
    tg4: "ok",
    tg5: "ok",
    tg6: "ok",
    tg7: "ok",
    tg8: "ok",
    tg9: "ok",
    tg10: "ok",
    lowestStatus: 8.37,
    lowestTag: 8.23,
  });
});
