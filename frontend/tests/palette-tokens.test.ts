/// <reference types="node" />

import { readFileSync } from "node:fs";

const css = readFileSync("src/styles/kasten-theme.css", "utf8");

/** The 19 names every palette block sets, sorted. */
const NAMED = [
  "--k-accent",
  "--k-accent-wash",
  "--k-danger",
  "--k-highlight",
  "--k-info",
  "--k-link",
  "--k-mark",
  "--k-ok",
  "--k-warn",
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
].sort();

const PALETTES = ["poel", "russet", "peach", "pansy"];

/** The declarations of one palette block; a missing block reads as none. */
function declared(id: string, dark: boolean): Record<string, string> {
  const selector = `\\[data-palette="${id}"\\]${dark ? '\\[data-theme="dark"\\]' : ""}`;
  const block = new RegExp(`${selector}\\s*{([^}]*)}`).exec(css);
  return Object.fromEntries(
    [...(block?.[1] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] ?? "",
      (m[2] ?? "").trim(),
    ]),
  );
}

test("each palette block sets exactly the named tokens, light and dark alike", () => {
  const names = Object.fromEntries(
    PALETTES.map((id) => [
      id,
      {
        light: Object.keys(declared(id, false)).sort(),
        dark: Object.keys(declared(id, true)).sort(),
      },
    ]),
  );
  expect(names).toEqual({
    poel: { light: NAMED, dark: NAMED },
    russet: { light: NAMED, dark: NAMED },
    peach: { light: NAMED, dark: NAMED },
    pansy: { light: NAMED, dark: NAMED },
  });
});

test("every palette's accent and highlight are the issue's table", () => {
  const picked = (id: string, dark: boolean) => {
    const block = declared(id, dark);
    return {
      accent: block["--k-accent"],
      link: block["--k-link"],
      wash: block["--k-accent-wash"],
      highlight: block["--k-highlight"],
      mark: block["--k-mark"],
    };
  };
  // The issue's table, as written. The wash is the accent at .11 in light and
  // .14 in dark; the link and the mark are the accent and the highlight.
  expect({
    poel: { light: picked("poel", false), dark: picked("poel", true) },
    russet: { light: picked("russet", false), dark: picked("russet", true) },
    peach: { light: picked("peach", false), dark: picked("peach", true) },
    pansy: { light: picked("pansy", false), dark: picked("pansy", true) },
  }).toEqual({
    poel: {
      light: {
        accent: "#316f90",
        link: "#316f90",
        wash: "rgba(49,111,144,.11)",
        highlight: "rgba(249,157,27,.22)",
        mark: "rgba(249,157,27,.22)",
      },
      dark: {
        accent: "#82b9d9",
        link: "#82b9d9",
        wash: "rgba(130,185,217,.14)",
        highlight: "rgba(167,212,228,.18)",
        mark: "rgba(167,212,228,.18)",
      },
    },
    russet: {
      light: {
        accent: "#9a5143",
        link: "#9a5143",
        wash: "rgba(154,81,67,.11)",
        highlight: "rgba(98,198,191,.30)",
        mark: "rgba(98,198,191,.30)",
      },
      dark: {
        accent: "#e59c8d",
        link: "#e59c8d",
        wash: "rgba(229,156,141,.14)",
        highlight: "rgba(98,198,191,.24)",
        mark: "rgba(98,198,191,.24)",
      },
    },
    peach: {
      light: {
        accent: "#b93100",
        link: "#b93100",
        wash: "rgba(185,49,0,.11)",
        highlight: "rgba(238,180,128,.30)",
        mark: "rgba(238,180,128,.30)",
      },
      dark: {
        accent: "#fd8e70",
        link: "#fd8e70",
        wash: "rgba(253,142,112,.14)",
        highlight: "rgba(238,180,128,.24)",
        mark: "rgba(238,180,128,.24)",
      },
    },
    pansy: {
      light: {
        accent: "#a83f5d",
        link: "#a83f5d",
        wash: "rgba(168,63,93,.11)",
        highlight: "rgba(249,193,206,.30)",
        mark: "rgba(249,193,206,.30)",
      },
      dark: {
        accent: "#f48da5",
        link: "#f48da5",
        wash: "rgba(244,141,165,.14)",
        highlight: "rgba(249,193,206,.24)",
        mark: "rgba(249,193,206,.24)",
      },
    },
  });
});
