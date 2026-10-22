import { expect, it } from "vitest";
import {
  axis,
  backdrop,
  closes,
  follow,
  project,
  rubberBand,
  type Sample,
  speed,
} from "@/lib/sheet-math";

it("project turns a release speed into the px the sheet would coast", () => {
  // v / 1000 * 0.99 / 0.01 = 99 px for 1000 px/s, and 0.4 * 99 = 39.6 for 400.
  expect(project(1000)).toBeCloseTo(99, 9);
  expect(project(400)).toBeCloseTo(39.6, 9);
});

it("rubberBand pulls an offset past the top back by a fraction, and keeps zero at zero", () => {
  // -100 * 600 * 0.55 / (600 + 0.55 * 100) = -33000 / 655 = -50.381679...
  expect(rubberBand(-100, 600)).toBeCloseTo(-50.381679389, 8);
  expect(rubberBand(0, 600)).toBe(0);
});

it("follow moves 1:1 down and rubber-bands up", () => {
  expect(follow(50, 600)).toBe(50);
  expect(follow(-100, 600)).toBe(rubberBand(-100, 600));
});

it("speed reads px/s from the samples in the last 100 ms", () => {
  // 40 px in 100 ms is 400 px/s. Read 90 ms after the last move, the finger has
  // stopped, so 0. A sample older than the 100 ms window is not counted.
  const samples: Sample[] = [
    { t: 0, y: 0 },
    { t: 50, y: 20 },
    { t: 100, y: 40 },
  ];
  expect(speed(samples, 100)).toBe(400);
  expect(speed(samples, 190)).toBe(0);
  expect(speed([{ t: -50, y: -1000 }, ...samples], 100)).toBe(400);
});

it("axis waits for 10 px of travel, then picks the axis that moved more", () => {
  expect(axis(9, 0)).toBe("pending");
  expect(axis(3, 10)).toBe("drag");
  expect(axis(12, 5)).toBe("scroll");
  expect(axis(10, 10)).toBe("drag");
});

it("closes on a flick or a coast past half the height", () => {
  // Flick: 401 > 400 px/s. Coast: 0 + 29.7 is under 300, and 280 + 29.7 = 309.7 is over.
  expect(closes(0, 401, 600)).toBe(true);
  expect(closes(0, 300, 600)).toBe(false);
  expect(closes(280, 300, 600)).toBe(true);
  expect(closes(250, -100, 600)).toBe(false);
});

it("backdrop fades from full at the top to none at the bottom, and clamps past both", () => {
  expect(backdrop(0, 600)).toBe(1);
  expect(backdrop(300, 600)).toBe(0.5);
  expect(backdrop(600, 600)).toBe(0);
  expect(backdrop(-40, 600)).toBe(1);
  expect(backdrop(700, 600)).toBe(0);
});
