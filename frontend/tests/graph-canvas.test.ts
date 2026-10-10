/**
 * The canvas's own arithmetic. The drawing itself needs a canvas, which jsdom
 * has not got, so `force-graph` is replaced and never called.
 */

import { radiusOf } from "@/lib/graph";
import { hitRadius } from "@/lib/graph-canvas";

vi.mock("force-graph", () => ({ default: class {} }));

describe("hitRadius", () => {
  it("is the dot and a little more for a mouse, at any zoom", () => {
    expect(hitRadius(4, 0.2, false)).toBe(radiusOf(4) + 2);
    expect(hitRadius(4, 3, false)).toBe(radiusOf(4) + 2);
  });

  it("stays 24 pixels across on screen for a finger when zoomed out", () => {
    const scale = 0.5;
    expect(hitRadius(0, scale, true) * scale * 2).toBe(24);
  });

  it("is the mouse's area for a finger once the dot is drawn larger than that", () => {
    expect(hitRadius(4, 3, true)).toBe(hitRadius(4, 3, false));
  });
});
