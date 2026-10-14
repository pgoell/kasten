import {
  CLOZE_SR,
  clozeAnswer,
  clozeNumbers,
  clozePlain,
  clozeQuestion,
  clozeTarget,
  divide,
  fences,
  SR,
  suspended,
  withoutToken,
} from "@/lib/card-line";

describe("a cloze line", () => {
  const LINE = "The capital of {{c1::France}} is {{c2::Paris::a city}}.";

  it("holds one number per mark, ascending and once each", () => {
    expect(clozeNumbers("{{c2::b}} {{c1::a}} {{c2::c}}")).toEqual([1, 2]);
    expect(clozeNumbers("What does S3 stand for?::Simple Storage Service")).toEqual([]);
  });

  it("hides that number's text as [...], or as [hint], and shows every other plain", () => {
    // Escaped, the front being markdown: a bare `[...]` is a link to the
    // preview, which hides the brackets and leaves `...` on the card.
    expect(clozeQuestion(LINE, 1)).toBe("The capital of \\[...\\] is Paris.");
    expect(clozeQuestion(LINE, 2)).toBe("The capital of France is \\[a city\\].");
  });

  it("reads as its plain sentence where no number is asked", () => {
    expect(clozePlain(`${LINE} !suspended <!--SR:c1!2026-08-20,4,270-->`)).toBe(
      "The capital of France is Paris.",
    );
  });

  it("highlights that number's text on the answer and shows the others plain", () => {
    expect(clozeAnswer(LINE, 1)).toBe("The capital of ==France== is Paris.");
    expect(clozeAnswer(LINE, 2)).toBe("The capital of France is ==Paris==.");
  });

  it("hides two marks of one number together, as one card", () => {
    const water = "Water is {{c1::H}}2{{c1::O}}.";
    expect(clozeNumbers(water)).toEqual([1]);
    expect(clozeQuestion(water, 1)).toBe("Water is \\[...\\]2\\[...\\].");
    expect(clozeAnswer(water, 1)).toBe("Water is ==H==2==O==.");
    expect(clozeTarget(water, 1)).toBe("H, O");
  });

  it("reads an empty hint as no hint", () => {
    expect(clozeQuestion("{{c1::A::}} b", 1)).toBe("\\[...\\] b");
    expect(clozeAnswer("{{c1::A::}} b", 1)).toBe("==A== b");
    expect(clozeTarget("{{c1::A::}} b", 1)).toBe("A");
  });

  it("takes the typed answer off the hidden text alone, never the hint", () => {
    expect(clozeTarget(LINE, 2)).toBe("Paris");
  });

  it("keeps its labelled comment and the plain one from matching each other", () => {
    expect(CLOZE_SR.test("<!--SR:c1!2026-08-20,4,270-->")).toBe(true);
    expect(SR.test("<!--SR:c1!2026-08-20,4,270-->")).toBe(false);
    expect(CLOZE_SR.test("<!--SR:!2026-08-20,4,270-->")).toBe(false);
  });
});

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
