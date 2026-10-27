import { sameAnswer } from "@/lib/review/card-text";
import { parseCards } from "@/lib/review/srs";
import { only } from "./srs-fixture";

describe("a literal &#58; the import wrote escaped (#340)", () => {
  const ID = " <!--anki:1:0:abcdef12-->";
  const read = (line: string) => parseCards(`#flashcards/x\n\n${line}${ID}\n`);

  it("shows \\&#58; as the text &#58; on both sides of an imported card", () => {
    const [card] = read("What is \\&#58;?::a\\&#58;b");

    expect(card?.front).toBe("What is &#58;?");
    expect(card?.back).toBe("a&#58;b");
  });

  it("asks \\&#58; in a cloze answer as the text &#58;", () => {
    const [card] = read("{{c1::a\\&#58;b}}");

    expect(card?.front).toBe("\\[...\\]");
    expect(card?.back).toBe("==a&#58;b==");
    expect(card?.target).toBe("a&#58;b");
  });

  it("shows \\&#58; in a highlight as the text &#58;", () => {
    const [card] = read("=={\\&#58;==::");

    expect(card?.front).toBe("=={&#58;==");
  });

  it("keeps the import's own &#58; a colon beside a literal one", () => {
    const [card] = read("{{c1::a&#58;&#58;b\\&#58;}}");

    expect(card?.back).toBe("==a::b&#58;==");
    expect(card?.target).toBe("a::b&#58;");
  });

  it("shows a hand-written \\&#58; as the text &#58;", () => {
    const [card] = parseCards("Is \\&#58; a colon?::no, &#58; is\n");

    expect(card?.front).toBe("Is &#58; a colon?");
    expect(card?.back).toBe("no, : is");
  });
});

describe("an escape the import writes (#342, #343)", () => {
  const ID = " <!--anki:1:0:abcdef12-->";
  const read = (line: string) => parseCards(`#flashcards/x\n\n${line}${ID}\n`);

  it("A2 shows a code span holding &#58; as written on both sides", () => {
    const [card] = read("What is `&#58;`?::`&#58;`");

    expect(card?.front).toBe("What is `&#58;`?");
    expect(card?.back).toBe("`&#58;`");
  });

  it("A2 asks a code span holding &#58; in a cloze answer as written", () => {
    const [card] = read("{{c1::`&#58;`}}");

    expect(card?.back).toBe("==`&#58;`==");
    // Nobody types the backticks (#346).
    expect(card?.target).toBe("&#58;");
  });

  it("A3 hands an escaped backslash to the preview on both sides", () => {
    const [card] = read("a\\\\-b::a\\\\-b");

    expect(card?.front).toBe("a\\\\-b");
    expect(card?.back).toBe("a\\\\-b");
  });

  it("A4 asks a\\\\&#58;&#58;b as a backslash before ::", () => {
    const [card] = read("{{c1::a\\\\&#58;&#58;b}}");

    expect(card?.front).toBe("\\[...\\]");
    expect(card?.back).toBe("==a\\\\::b==");
    expect(card?.target).toBe("a\\::b");
    expect(sameAnswer("a\\::b", card?.target ?? "")).toBe(true);
  });

  it("A4 takes markdown's escapes off the typed target, and not inside code", () => {
    const [card] = read("{{c1::\\*a\\* `\\*`}}");

    // The backticks go, as nobody types them (#346); the escape inside stays.
    expect(card?.target).toBe("*a* \\*");
  });
});

describe("a code span is code (#346, #347)", () => {
  const ID = " <!--anki:1:0:abcdef12-->";
  const read = (line: string) => parseCards(`#flashcards/x\n\n${line}${ID}\n`);

  it("A1 asks {{c1::`a::b`}} as one card, typed without the backticks", () => {
    const cards = read("{{c1::`a::b`}}");

    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe("\\[...\\]");
    expect(cards[0]?.back).toBe("==`a::b`==");
    expect(cards[0]?.target).toBe("a::b");
    expect(sameAnswer("a::b", cards[0]?.target ?? "")).toBe(true);
  });

  it("A3 parks no card for a token inside a code span on its front", () => {
    expect(only("`a !suspended b`::c").parked).toBeNull();
    expect(only("`a !suspended b`\n?\nc").parked).toBeNull();
  });

  it("A3 parks no cloze for a token inside a code span", () => {
    expect(read("{{c1::x}} `a !suspended b`")[0]?.parked).toBeNull();
    expect(read("{{c1::`!suspended`}}")[0]?.parked).toBeNull();
  });

  it("B3 types a nested mark from code without backticks", () => {
    const [c1, c2] = read("{{c1::`a` {{c2::`b`}}}}");

    expect(c1?.target).toBe("a b");
    expect(c2?.target).toBe("b");
  });

  it("B2 asks no card for a 0.49.x line with a mark in code", () => {
    expect(parseCards("`{{c1::a&#58;&#58;b}}` <!--SR:c1!2026-10-20,3,250-->")).toEqual([]);
    expect(parseCards("`{{c1::x}}`")).toEqual([]);
  });

  it("I4 keeps a token inside a code span on the back", () => {
    expect(only("q::`a !suspended b`").back).toBe("`a !suspended b`");
  });
});

describe("a schedule comment in a cloze answer (#351)", () => {
  const ID = " <!--anki:1:0:abcdef12-->";
  const read = (line: string) => parseCards(`#flashcards/x\n\n${line}${ID}\n`);

  it("A1 reads no schedule from a comment inside a cloze answer", () => {
    const cards = read("{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}");

    expect(cards).toHaveLength(1);
    expect(cards[0]?.held).toBeNull();
  });

  it("A1 types the comment as Anki shows it", () => {
    const card = read("{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}")[0];

    expect(card?.target).toBe("<!--SR:c1!2026-01-01,1,250-->");
  });

  it("A2 reads no schedule from a comment in code inside a cloze answer", () => {
    const cards = read("{{c1::`<!--SR\\:c1!2026-01-01,1,250-->`}}");

    expect(cards).toHaveLength(1);
    expect(cards[0]?.held).toBeNull();
  });

  it("B1 types a comment beside :: as Anki shows it", () => {
    const card = read("{{c1::<!--SR&#58;c1!2026-01-01,1,250--> a&#58;&#58;b}}")[0];

    expect(card?.held).toBeNull();
    expect(card?.target).toBe("<!--SR:c1!2026-01-01,1,250--> a::b");
  });

  it("I1 reads the line's own schedule, not the one in the answer", () => {
    const line = "{{c1::<!--SR\\:c1!2026-01-01,1,250-->}}";
    const cards = parseCards(`#flashcards/x\n\n${line}${ID} <!--SR:c1!2026-10-20,3,250-->\n`);

    expect(cards[0]?.held).toEqual({ due: "2026-10-20", interval: 3, ease: 250 });
  });
});

describe("a comment the import escaped in a code span (#356)", () => {
  const ID = " <!--anki:1:0:abcdef12-->";
  const read = (line: string) => parseCards(`#flashcards/x\n\n${line}${ID}\n`);

  it("A14 shows and types a schedule comment in code without the backslash", () => {
    const card = read("{{c1::`<!--SR\\:c1!2026-01-01,1,250-->`}}")[0];

    expect(card?.target).toBe("<!--SR:c1!2026-01-01,1,250-->");
    expect(card?.back).toBe("==`<!--SR:c1!2026-01-01,1,250-->`==");
    expect(sameAnswer("<!--SR:c1!2026-01-01,1,250-->", card?.target ?? "")).toBe(true);
  });

  it("A14 reads no schedule from it", () => {
    expect(read("{{c1::`<!--SR\\:c1!2026-01-01,1,250-->`}}")[0]?.held).toBeNull();
  });

  it("A14 shows the comment and the marker in code on a basic side without the backslash", () => {
    const card = read("`<!--anki\\:7:0-->`::`<!--SR\\:!2026-01-01,1,250-->`")[0];

    expect(card?.front).toBe("`<!--anki:7:0-->`");
    expect(card?.back).toBe("`<!--SR:!2026-01-01,1,250-->`");
    expect(card?.held).toBeNull();
  });

  it("A13 shows the marker beside :: as Anki shows it", () => {
    const card = read("{{c1::<!--anki&#58;7&#58;0--> a&#58;&#58;b}}")[0];

    expect(card?.target).toBe("<!--anki:7:0--> a::b");
    expect(card?.back).toBe("==<!--anki:7:0--> a::b==");
  });
});
