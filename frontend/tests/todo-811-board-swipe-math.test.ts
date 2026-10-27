import { rubberBand } from "@/lib/sheet-math";
import { swipeOffset, swipeTarget } from "@/lib/todo/column-swipe";

// Seven states on a 390 px phone, the column width the board measures.
const WIDTH = 390;
const COUNT = 7;

describe("the column swipe's offset (#811 A8)", () => {
  it("#811 A8 the column follows the finger between the ends", () => {
    expect(swipeOffset(-50, WIDTH, 1, COUNT)).toBe(-50);
    expect(swipeOffset(80, WIDTH, 3, COUNT)).toBe(80);
  });

  it("#811 A8 the first column pulled right gives a rubber band, less than the finger", () => {
    const offset = swipeOffset(100, WIDTH, 0, COUNT);

    expect(offset).toBe(rubberBand(100, WIDTH));
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(100);
  });

  it("#811 A8 the last column pulled left gives a rubber band, less than the finger", () => {
    const offset = swipeOffset(-100, WIDTH, COUNT - 1, COUNT);

    expect(offset).toBe(rubberBand(-100, WIDTH));
    expect(offset).toBeLessThan(0);
    expect(offset).toBeGreaterThan(-100);
  });
});

describe("the column swipe's release (#811 A8 I2)", () => {
  it("#811 A8 a release past a quarter steps to the next column", () => {
    expect(swipeTarget(-100, 0, WIDTH, 1, COUNT)).toBe(1);
  });

  it("#811 A8 a release past a quarter steps to the previous column", () => {
    expect(swipeTarget(100, 0, WIDTH, 1, COUNT)).toBe(-1);
  });

  it("#811 I2 a release short of a quarter stays on the column", () => {
    expect(swipeTarget(-90, 0, WIDTH, 1, COUNT)).toBe(0);
    expect(swipeTarget(90, 0, WIDTH, 1, COUNT)).toBe(0);
  });

  it("#811 A8 a flick carries a short release past a quarter", () => {
    // A 40 px drag with a leftward flick of 1000 px/s coasts about 99 px more.
    expect(swipeTarget(-40, -1000, WIDTH, 1, COUNT)).toBe(1);
  });

  it("#811 A8 no column steps past the first or the last", () => {
    expect(swipeTarget(300, 0, WIDTH, 0, COUNT)).toBe(0);
    expect(swipeTarget(-300, 0, WIDTH, COUNT - 1, COUNT)).toBe(0);
  });
});
