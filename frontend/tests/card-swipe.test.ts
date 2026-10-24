import { stampOf, swipeGrade, TILT, tiltOf } from "@/lib/card-swipe";

const WIDTH = 390;
// Written out here, not read from GRADE_AT, so a change to the constant is caught.
const EDGE = 0.38 * WIDTH;

describe("card swipe arithmetic", () => {
  it("tilts a card 0.025 degrees per px", () => {
    expect(TILT).toBe(0.025);
    expect(tiltOf(100)).toBeCloseTo(2.5, 10);
    expect(tiltOf(-40)).toBeCloseTo(-1, 10);
    expect(tiltOf(0)).toBe(0);
  });

  it("shows the Good stamp to the right and the Again stamp to the left", () => {
    expect(stampOf(100, WIDTH).rating).toBe("good");
    expect(stampOf(-100, WIDTH).rating).toBe("again");
  });

  it("shows no stamp at rest", () => {
    expect(stampOf(0, WIDTH)).toEqual({ rating: null, opacity: 0 });
  });

  it("fades the stamp in with the drag, full at 38 percent of the width", () => {
    expect(stampOf(EDGE / 2, WIDTH).opacity).toBeCloseTo(0.5, 10);
    expect(stampOf(-EDGE / 2, WIDTH).opacity).toBeCloseTo(0.5, 10);
    expect(stampOf(EDGE, WIDTH).opacity).toBe(1);
    expect(stampOf(-EDGE * 2, WIDTH).opacity).toBe(1);
  });

  it("does not grade a release just under 38 percent of the width", () => {
    expect(swipeGrade(EDGE - 1, 0, WIDTH)).toBeNull();
    expect(swipeGrade(-(EDGE - 1), 0, WIDTH)).toBeNull();
  });

  it("grades a release just over 38 percent of the width", () => {
    expect(swipeGrade(EDGE + 1, 0, WIDTH)).toBe("good");
    expect(swipeGrade(-(EDGE + 1), 0, WIDTH)).toBe("again");
  });

  it("does not grade a release exactly at 38 percent of the width", () => {
    expect(swipeGrade(EDGE, 0, WIDTH)).toBeNull();
    expect(swipeGrade(-EDGE, 0, WIDTH)).toBeNull();
  });

  it("grades a slow short drag that a fast release projects past 38 percent", () => {
    expect(swipeGrade(100, 0, WIDTH)).toBeNull();
    expect(swipeGrade(100, 1000, WIDTH)).toBe("good");
  });

  it("does not grade a long drag released moving back that projects under 38 percent", () => {
    expect(swipeGrade(200, -1000, WIDTH)).toBeNull();
  });
});
