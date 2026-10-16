import {
  ANKI_ID,
  CLOZE_SR,
  clozeAnswer,
  clozeNumbers,
  clozePlain,
  clozeQuestion,
  clozeTarget,
  colons,
  divide,
  fences,
  holdsCloze,
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

describe("a nested cloze line", () => {
  const CANBERRA = "{{c1::Canberra was {{c2::founded}} in 1913}}";
  const HINTED = "foo {{c1::bar {{c2::baz::h2}}::h1}}";
  const THREE = "{{c1::a {{c2::b {{c3::c}}}}}}";

  it("A2 card c1 hides the whole nested span", () => {
    expect(clozeNumbers(CANBERRA)).toEqual([1, 2]);
    expect(clozeQuestion(CANBERRA, 1)).toBe("\\[...\\]");
  });

  it("A3 card c2 hides the inner text alone and shows the rest", () => {
    expect(clozeQuestion(CANBERRA, 2)).toBe("Canberra was \\[...\\] in 1913");
  });

  it("A4 asks each level by its own hint, the outer one after the inner mark", () => {
    expect(clozeQuestion(HINTED, 1)).toBe("foo \\[h1\\]");
    expect(clozeQuestion(HINTED, 2)).toBe("foo bar \\[h2\\]");
    // A hint holds no mark, so one after the `::` is the text's and still asked.
    const late = "{{c1::a::{{c2::b}}}}";
    expect(clozeNumbers(late)).toEqual([1, 2]);
    expect(clozeQuestion(late, 1)).toBe("\\[...\\]");
    expect(clozeQuestion(late, 2)).toBe("a::\\[...\\]");
  });

  it("A5 reads broken nesting as text, keeps a balanced inner mark, and never throws", () => {
    const unclosed = "{{c1::a {{c2::b}}";
    expect(clozeNumbers(unclosed)).toEqual([2]);
    expect(clozeQuestion(unclosed, 2)).toBe("{{c1::a \\[...\\]");
    expect(clozeAnswer(unclosed, 2)).toBe("{{c1::a ==b==");
    expect(clozeTarget(unclosed, 2)).toBe("b");

    // A stray close reads as it did before nesting was read.
    const stray = "{{c1::a }} b}}";
    expect(clozeNumbers(stray)).toEqual([1]);
    expect(clozeQuestion(stray, 1)).toBe("\\[...\\] b}}");
    expect(clozeAnswer(stray, 1)).toBe("==a == b}}");

    const long = "{{c1::".repeat(834);
    expect(long.length).toBeGreaterThanOrEqual(5000);
    expect(clozeNumbers(long)).toEqual([]);
    expect(clozePlain(long)).toBe(long);
    const deep = `${"{{c1::x ".repeat(600)}y${"}}".repeat(600)}`;
    expect(clozeNumbers(deep)).toEqual([1]);
    expect(clozeTarget(deep, 1)).toBe(`${"x ".repeat(600)}y`);
  });

  it("names a cloze whose answer the import wrote with &#58; by its colons", () => {
    expect(clozePlain("{{c1::a&#58;&#58;b}} x")).toBe("a::b x");
  });

  it("names a cloze holding an escaped \\&#58; by the text &#58;", () => {
    expect(clozePlain("{{c1::a&#58;&#58;b\\&#58;}} x")).toBe("a::b&#58; x");
  });

  it("I2 highlights the answer flat, the inner text plain inside", () => {
    expect(clozeAnswer(CANBERRA, 1)).toBe("==Canberra was founded in 1913==");
    expect(clozeAnswer(CANBERRA, 2)).toBe("Canberra was ==founded== in 1913");
    expect(clozeAnswer(HINTED, 1)).toBe("foo ==bar baz==");
    expect(clozeAnswer(HINTED, 2)).toBe("foo bar ==baz==");
  });

  it("I3 compares typing against each level's plain text, never a hint", () => {
    expect(clozeTarget(CANBERRA, 1)).toBe("Canberra was founded in 1913");
    expect(clozeTarget(CANBERRA, 2)).toBe("founded");
    expect(clozeTarget(HINTED, 1)).toBe("bar baz");
    expect(clozeTarget(HINTED, 2)).toBe("baz");
  });

  it("I4 asks one number nested in itself as one card", () => {
    const same = "{{c1::outer {{c1::inner}}}}";
    expect(clozeNumbers(same)).toEqual([1]);
    expect(clozeQuestion(same, 1)).toBe("\\[...\\]");
    expect(clozeAnswer(same, 1)).toBe("==outer inner==");
    expect(clozeTarget(same, 1)).toBe("outer inner");
  });

  it("I5 still reads a lone brace inside a mark as no mark", () => {
    expect(clozeNumbers("{{c1::\\(x^{2}\\)}}")).toEqual([]);
    expect(clozeNumbers("{{c1::a {{c2::\\(x^{2}\\)}}}}")).toEqual([]);
  });

  it("I6 reads three levels", () => {
    expect(clozeNumbers(THREE)).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((cloze) => clozeQuestion(THREE, cloze))).toEqual([
      "\\[...\\]",
      "a \\[...\\]",
      "a b \\[...\\]",
    ]);
    expect([1, 2, 3].map((cloze) => clozeAnswer(THREE, cloze))).toEqual([
      "==a b c==",
      "a ==b c==",
      "a b ==c==",
    ]);
    expect([1, 2, 3].map((cloze) => clozeTarget(THREE, cloze))).toEqual(["a b c", "b c", "c"]);
  });

  it("I7 reads a nested line as its plain sentence", () => {
    expect(clozePlain(`${CANBERRA} <!--SR:c2!2026-08-20,4,270-->`)).toBe(
      "Canberra was founded in 1913",
    );
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

describe("the anki id", () => {
  it("comes off a side only where it is the whole marker", () => {
    expect(ANKI_ID.test("<!--anki:1700000000000:0:0a1b2c3d-->")).toBe(true);
    expect(divide("Q::A <!--anki:1700000000000:0:0a1b2c3d-->")?.back).toBe("A");
    expect(divide("Q::A <!--anki:5:1:0a1b2c3d--> <!--SR:!2026-08-20,4,270-->")?.back).toBe("A");
    expect(clozeAnswer("The {{c1::WAL}}. <!--anki:5:0:0a1b2c3d-->", 1)).toBe("The ==WAL==.");
    expect(clozeQuestion("The {{c1::WAL}}. <!--anki:5:0:0a1b2c3d-->", 1)).toBe("The \\[...\\].");

    // Text that only looks like one is the answer somebody wrote, kept whole.
    expect(divide("Q::A <!--anki:x:0:0a1b2c3d-->")?.back).toBe("A <!--anki:x:0:0a1b2c3d-->");
    expect(divide("Q::A <!--anki:5:0-->")?.back).toBe("A <!--anki:5:0-->");
    expect(divide("Q::A <!--anki:5:0:1-->")?.back).toBe("A <!--anki:5:0:1-->");
    expect(divide("Q::A <!--anki:5:0:0A1B2C3D-->")?.back).toBe("A <!--anki:5:0:0A1B2C3D-->");
    expect(divide("Q::A <!--anki::-->")?.back).toBe("A <!--anki::-->");
  });
});

describe("colons", () => {
  it("I3 leaves a code span alone and decodes &#58; beside it", () => {
    expect(colons("`&#58;` and a&#58;b")).toBe("`&#58;` and a:b");
  });

  it("I3 closes a code span at a run of its own length", () => {
    expect(colons("``a`&#58;`` &#58;")).toBe("``a`&#58;`` :");
  });

  it("I3 reads an unclosed backtick as no code span", () => {
    expect(colons("`a&#58;b")).toBe("`a:b");
    expect(colons("``a&#58;`")).toBe("``a:`");
  });

  it("I3 reads an escaped backtick as no code span", () => {
    expect(colons("\\`&#58;\\`")).toBe("\\`:\\`");
  });

  it("reads \\\\&#58; as an escaped backslash before a colon", () => {
    expect(colons("a\\\\&#58;b")).toBe("a\\\\:b");
  });
});

describe("a code span is code (#346, #347)", () => {
  it("A1 reads a code span inside a mark as its answer, :: and all", () => {
    const line = "{{c1::`a::b`}}";

    expect(clozeNumbers(line)).toEqual([1]);
    expect(clozeQuestion(line, 1)).toBe("\\[...\\]");
    expect(colons(clozeAnswer(line, 1))).toBe("==`a::b`==");
  });

  it("I1 splits no hint at a :: inside a code span", () => {
    const line = "{{c1::`a::b`::h}}";

    expect(clozeQuestion(line, 1)).toBe("\\[h\\]");
    expect(clozeTarget(line, 1)).toBe("`a::b`");
  });

  it("I1 still reads a mark holding a lone backtick", () => {
    expect(clozeNumbers("{{c1::a`b}}")).toEqual([1]);
    expect(clozeTarget("{{c1::a`b}}", 1)).toBe("a`b");
  });

  it("I2 reads no mark whose opener sits inside a code span", () => {
    expect(holdsCloze("`{{c1::x}}`")).toBe(false);
    expect(clozeNumbers("`{{c1::x}}`")).toEqual([]);
    expect(clozeNumbers("`{{c1::x}}` {{c2::y}}")).toEqual([2]);
  });

  it("B1 reads a line of many code spans after an open mark in linear time", () => {
    // Nested quantifiers took 3 seconds at 14 spans, doubling with each one more.
    const line = `Use {{c1::${" `x`".repeat(30)}`;
    const start = performance.now();

    expect(clozeNumbers(line)).toEqual([]);
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("A3 finds no token inside a code span", () => {
    expect(suspended("`a !suspended b`::c")).toBe(false);
    expect(suspended("`a` !suspended")).toBe(true);
  });

  it("I4 takes off only a token outside code", () => {
    expect(withoutToken("`a !suspended b`")).toBe("`a !suspended b`");
    expect(withoutToken("`a !suspended b` !suspended")).toBe("`a !suspended b`");
  });
});
