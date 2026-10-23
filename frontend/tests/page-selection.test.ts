import { type Anchor, low } from "@/lib/page-selection";

/** A place whose passage's middle is `middle` px down a wrapper 800 px tall. `low` reads only that. */
function at(middle: number): Anchor {
  return { x: 0, y: middle, above: true, middle, box: { width: 400, height: 800 } };
}

it("a take with no place, or a place in the upper half, is not low", () => {
  expect({ none: low(null), high: low(at(100)), low: low(at(500)) }).toEqual({
    none: false,
    high: false,
    low: true,
  });
});
