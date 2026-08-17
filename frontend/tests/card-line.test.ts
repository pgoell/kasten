import { fences } from "@/lib/card-line";

describe("fences", () => {
  it("marks the lines inside a fenced block and the markers themselves", () => {
    expect(fences(["a::b", "```", "c::d", "```", "e::f"])).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });
});
