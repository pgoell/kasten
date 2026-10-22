/// <reference types="node" />

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { afterRelease, FLICK_DAMPING, SPRINGS, Spring, springAt } from "@/lib/spring";

const css = readFileSync("src/styles/kasten-theme.css", "utf8");

function token(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  if (!match) throw new Error(`no token ${name}`);
  return (match[1] ?? "").trim();
}

// The frames are driven by hand: `run(at)` sets the clock and fires the one
// frame requested, so a test decides when each frame lands.
function fakeClock() {
  let now = 0;
  let pending: ((at: number) => void) | null = null;
  return {
    options: {
      now: () => now,
      frame: (cb: (at: number) => void) => {
        pending = cb;
        return 1;
      },
      cancel: () => {
        pending = null;
      },
      reduced: () => false,
    },
    run(at: number) {
      now = at;
      const cb = pending;
      pending = null;
      cb?.(at);
    },
  };
}

it("springAt at t 0 gives back the start value and velocity", () => {
  const at = springAt(100, 5, 0, SPRINGS.default, 0);
  expect(at.value).toBe(100);
  expect(at.velocity).toBe(5);

  const soft = springAt(100, 5, 0, { damping: 0.8, response: 1 }, 0);
  expect(soft.value).toBe(100);
  expect(soft.velocity).toBeCloseTo(5, 10);
});

it("springAt with damping 1 matches the closed form and the hand value 86.86885", () => {
  // omega = 2 PI for response 1, so at t 0.1 the value is
  // (100 + 2 PI * 100 * 0.1) * e^(-0.2 PI), which is 86.86885... by hand.
  const config = { damping: 1, response: 1 };
  const at = springAt(100, 0, 0, config, 0.1);
  expect(at.value).toBeCloseTo((100 + 2 * Math.PI * 100 * 0.1) * Math.exp(-0.2 * Math.PI), 9);
  expect(at.value).toBeCloseTo(86.86885, 4);

  // The velocity is the derivative: a numeric slope of the value must agree.
  const h = 1e-6;
  const slope =
    (springAt(100, 0, 0, config, 0.1 + h).value - springAt(100, 0, 0, config, 0.1 - h).value) /
    (2 * h);
  expect(at.velocity).toBeCloseTo(slope, 3);
});

it("springAt with damping 0.8 matches the closed form and the hand value 85.93585", () => {
  // omega = 2 PI, so wd = 1.2 PI and the amplitude term is 400/3 (0.8 * 100 / 0.6).
  // At t 0.1: e^(-0.16 PI) * (100 cos(0.12 PI) + (400/3) sin(0.12 PI)), which is
  // 0.604923 * 142.060916 = 85.93585... by hand.
  const at = springAt(100, 0, 0, { damping: 0.8, response: 1 }, 0.1);
  expect(at.value).toBeCloseTo(
    Math.exp(-0.16 * Math.PI) *
      (100 * Math.cos(0.12 * Math.PI) + (400 / 3) * Math.sin(0.12 * Math.PI)),
    9,
  );
  expect(at.value).toBeCloseTo(85.93585, 4);
});

it("springAt settles on the target for a large t", () => {
  expect(springAt(100, 0, 0, SPRINGS.default, 100).value).toBeCloseTo(0, 6);
  expect(springAt(100, 0, 0, { damping: 0.8, response: 1 }, 100).value).toBeCloseTo(0, 6);
});

it("afterRelease flicks to damping 0.8 only above 400 px/s", () => {
  const close = SPRINGS.sheetClose;
  expect(afterRelease(close, 401).damping).toBe(FLICK_DAMPING);
  expect(afterRelease(close, 400).damping).toBe(1);
  expect(afterRelease(close, -500).damping).toBe(FLICK_DAMPING);
});

it("Spring to moves toward the target and resolves true when it settles", async () => {
  const clock = fakeClock();
  const frames: number[] = [];
  const spring = new Spring(
    100,
    (value) => {
      frames.push(value);
    },
    clock.options,
  );

  const done = spring.to(0, SPRINGS.default);
  for (let at = 16; spring.moving && at < 5000; at += 16) clock.run(at);

  expect(frames[0]).toBeLessThan(100);
  expect(frames.every((value) => value >= 0 && value <= 100)).toBe(true);
  expect(spring.value).toBe(0);
  expect(frames[frames.length - 1]).toBe(0);
  await expect(done).resolves.toBe(true);
});

it("a frame stamped before the run began reads as its start", () => {
  const clock = fakeClock();
  const spring = new Spring(100, () => {}, clock.options);

  // The run is stamped at 0. A frame whose timestamp comes 5 ms earlier, which
  // the browser can do, must read as the start of the run, not a step back in time.
  spring.to(0, SPRINGS.default);
  clock.run(-5);

  expect(spring.value).toBe(100);
});

it("a second to mid-flight starts from the current value and velocity", async () => {
  const clock = fakeClock();
  const spring = new Spring(100, () => {}, clock.options);

  const first = spring.to(0, SPRINGS.default);
  clock.run(50);
  const value = spring.value;
  const speed = spring.velocity;
  // Mid-flight the speed is well away from zero, so a restart at rest would show.
  expect(Math.abs(speed)).toBeGreaterThan(100);

  spring.to(200, SPRINGS.default);
  clock.run(66);

  // The first frame after the retarget is the spring carried on from there,
  // not a jump back to rest or to the new target.
  const expected = springAt(value, speed, 200, SPRINGS.default, 0.016);
  expect(spring.value).toBeCloseTo(expected.value, 9);
  expect(spring.velocity).toBeCloseTo(expected.velocity, 9);
  await expect(first).resolves.toBe(false);
});

it("set mid-flight puts the value at once and resolves the run false", async () => {
  const clock = fakeClock();
  const frames: number[] = [];
  const spring = new Spring(
    100,
    (value) => {
      frames.push(value);
    },
    clock.options,
  );

  const running = spring.to(0, SPRINGS.default);
  clock.run(50);
  spring.set(70);

  expect(spring.value).toBe(70);
  expect(spring.velocity).toBe(0);
  expect(spring.moving).toBe(false);
  expect(frames[frames.length - 1]).toBe(70);

  // The cancelled frame never lands, so the finger's value holds.
  clock.run(66);
  expect(spring.value).toBe(70);
  await expect(running).resolves.toBe(false);
});

it("reduced motion puts the target at once and resolves true", async () => {
  const clock = fakeClock();
  const frames: number[] = [];
  const spring = new Spring(
    100,
    (value) => {
      frames.push(value);
    },
    { ...clock.options, reduced: () => true },
  );

  const done = spring.to(0, SPRINGS.default);

  expect(frames).toEqual([0]);
  expect(spring.value).toBe(0);
  expect(spring.velocity).toBe(0);
  await expect(done).resolves.toBe(true);
});

it("the spring constants equal the spring tokens in kasten-theme.css", () => {
  const damping = Number(token("--k-spring-damping"));
  expect(SPRINGS).toEqual({
    default: { damping, response: parseFloat(token("--k-spring-response")) },
    sheetOpen: { damping, response: parseFloat(token("--k-spring-sheet-open")) },
    sheetClose: { damping, response: parseFloat(token("--k-spring-sheet-close")) },
    tab: { damping, response: parseFloat(token("--k-spring-tab")) },
    split: { damping, response: parseFloat(token("--k-spring-split")) },
    card: { damping, response: parseFloat(token("--k-spring-card")) },
  });
  expect(FLICK_DAMPING).toBe(Number(token("--k-spring-flick-damping")));
});
