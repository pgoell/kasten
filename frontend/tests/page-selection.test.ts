import { type Anchor, low } from "@/lib/page-selection";

/** A button's place at `y` in a wrapper 800 px tall. `low` reads nothing else. */
function at(y: number): Anchor {
  return { x: 0, y, above: true, box: { width: 400, height: 800 } };
}

it("a take with no place, or a place in the upper half, is not low", () => {
  expect({ none: low(null), high: low(at(100)), low: low(at(500)) }).toEqual({
    none: false,
    high: false,
    low: true,
  });
});
