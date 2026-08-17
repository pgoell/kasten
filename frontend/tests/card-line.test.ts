import { divide, fences, suspended, withoutToken } from "@/lib/card-line";

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

describe("divide", () => {
  it("splits a card at its divider", () => {
    expect(divide("Q::A")).toEqual({ front: "Q", back: "A" });
  });

  it("splits at the first divider, so an answer keeps one of its own", () => {
    expect(divide("Q::A::B")?.back).toBe("A::B");
  });

  it("reads a question with no answer as a card whose back is empty", () => {
    expect(divide("Q::")).toEqual({ front: "Q", back: "" });
  });

  it("takes the schedule off the answer", () => {
    expect(divide("Q::A <!--SR:!2026-08-20,4,270-->")?.back).toBe("A");
  });

  it("answers nothing for a line holding no divider", () => {
    expect(divide("prose with no divider")).toBeNull();
  });
});
