import { fences, suspended, withoutToken } from "@/lib/card-line";

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

describe("suspended", () => {
  it("finds the token after a card's answer", () => {
    expect(suspended("a::b !suspended")).toBe(true);
  });

  it("finds it at the head of a line of its own", () => {
    expect(suspended("!suspended")).toBe(true);
  });

  it("is false for a line carrying none", () => {
    expect(suspended("a::b")).toBe(false);
  });
});

describe("withoutToken", () => {
  it("takes the token off, leaving no trailing space", () => {
    expect(withoutToken("A private link !suspended")).toBe("A private link");
  });
});
