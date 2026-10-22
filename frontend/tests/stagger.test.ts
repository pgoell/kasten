/// <reference types="node" />

import { readFileSync } from "node:fs";
import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ENTRANCE_MS, STAGGER_CAP, STAGGER_MS, staggerDelay, useEntrance } from "@/lib/stagger";

// A fake clock must not outlive its test, or the next test's timers never fire.
afterEach(() => {
  vi.useRealTimers();
});

const css = readFileSync("src/styles/kasten-theme.css", "utf8");

function token(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`no token ${name}`);
  return (match[1] ?? "").trim();
}

it("staggerDelay steps 22 ms a row and holds at the cap of 6", () => {
  // Row 5 is 5 * 22 = 110 ms. Row 6 is the cap, 6 * 22 = 132, and rows past it wait no longer.
  expect(staggerDelay(0)).toBe(0);
  expect(staggerDelay(5)).toBe(110);
  expect(staggerDelay(6)).toBe(132);
  expect(staggerDelay(40)).toBe(132);
});

it("useEntrance admits the keys of the first non-empty list, and no later key", () => {
  const { result, rerender } = renderHook(({ keys }: { keys: string[] }) => useEntrance(keys), {
    initialProps: { keys: ["a", "b"] },
  });
  expect(result.current("a")).toBe(true);

  rerender({ keys: ["a", "b", "c"] });
  expect(result.current("c")).toBe(false);
  expect(result.current("a")).toBe(true);
});

/** A row rendered with its key, `key` null being the row unmounted. */
function mountRow() {
  return renderHook(
    ({ keys, key }: { keys: string[]; key: string | null }) => {
      const admit = useEntrance(keys);
      return key === null ? null : admit(key);
    },
    { initialProps: { keys: ["a", "b"], key: "a" as string | null } },
  );
}

it("a first-load key that mounts again later does not enter again", () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const { result, rerender } = mountRow();
  expect(result.current).toBe(true);

  rerender({ keys: ["a", "b"], key: null });
  vi.advanceTimersByTime(ENTRANCE_MS + STAGGER_CAP * STAGGER_MS);
  rerender({ keys: ["a", "b"], key: "a" });
  expect(result.current).toBe(false);
});

it("a rerender during the entrance keeps the entrance", () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  const { result, rerender } = mountRow();

  vi.advanceTimersByTime(100);
  rerender({ keys: ["a", "b"], key: "a" });
  expect(result.current).toBe(true);
});

it("useEntrance admits nothing while the list is empty, then the first non-empty list", () => {
  const { result, rerender } = renderHook(({ keys }: { keys: string[] }) => useEntrance(keys), {
    initialProps: { keys: [] as string[] },
  });
  expect(result.current("a")).toBe(false);

  rerender({ keys: ["a"] });
  expect(result.current("a")).toBe(true);

  rerender({ keys: ["b"] });
  expect(result.current("b")).toBe(false);
});

it("the stagger constants equal the stagger tokens in kasten-theme.css", () => {
  expect(STAGGER_MS).toBe(parseFloat(token("--k-stagger")));
  expect(STAGGER_CAP).toBe(Number(token("--k-stagger-cap")));
});
