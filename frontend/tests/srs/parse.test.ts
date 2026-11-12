// @vitest-environment node
import { appendStub, writeSchedule } from "@/lib/review/card-write";
import { parseCards, readSchedule } from "@/lib/review/srs";
import { NOTE, only } from "./fixture";

describe("parseCards", () => {
  it("reads a card written on one line", () => {
    const card = only(NOTE);
    expect(card.front).toBe("What does S3 stand for?");
    expect(card.back).toBe("Simple Storage Service");
    expect(card.inline).toBe(true);
    expect(card.held).toBeNull();
  });

  it("reads a card written over three lines", () => {
    const card = only(NOTE, 1);
    expect(card.front).toBe("The three storage classes worth knowing");
    expect(card.back).toBe("Standard, Infrequent Access, Glacier");
    expect(card.inline).toBe(false);
  });

  it("spans the lines the card is written on", () => {
    const lines = NOTE.split("\n");
    const one = only(NOTE);
    const two = only(NOTE, 1);
    expect(lines[one.from]).toContain("S3");
    expect(one.from).toBe(one.to);
    expect(lines[two.from]).toBe("The three storage classes worth knowing");
    expect(lines[two.to]).toBe("Standard, Infrequent Access, Glacier");
  });

  it("keeps the schedule off the back of the card", () => {
    const text = `a::b <!--SR:!2026-08-20,4,270-->

q
?
r
<!--SR:!2026-08-14,1,230-->
`;
    const inline = only(text);
    const multi = only(text, 1);
    expect(inline.back).toBe("b");
    expect(inline.held).toEqual({ due: "2026-08-20", interval: 4, ease: 270 });
    expect(multi.back).toBe("r");
    expect(multi.held).toEqual({ due: "2026-08-14", interval: 1, ease: 230 });
  });

  it("takes the schedule line into the card's span", () => {
    const text = "q\n?\nr\n<!--SR:!2026-08-14,1,230-->\n";
    const card = only(text);
    expect(text.split("\n")[card.to]).toContain("SR:");
  });

  it("does not read a fenced code block", () => {
    const cards = parseCards("```cpp\nstd::vector<int> v;\n```\n\nreal::card\n");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe("real");
  });

  it("reads a back running over several lines", () => {
    expect(only("q\n?\nfirst\nsecond\n\nafter\n").back).toBe("first\nsecond");
  });

  it("stops a back at the next heading", () => {
    expect(only("q\n?\nanswer\n## Next\n").back).toBe("answer");
  });

  it("finds nothing in a note holding no card", () => {
    expect(parseCards("# Title\n\nordinary prose.\n")).toEqual([]);
  });
});

describe("parseCards on the decks a card is in", () => {
  it("puts every card of a tagged note in the note's deck", () => {
    expect(only(NOTE).decks).toEqual(["aws"]);
  });

  it("names a bare tag's deck after the note", () => {
    expect(parseCards("#flashcards\n\na::b\n", "Terraform drills")[0]?.decks).toEqual([
      "Terraform drills",
    ]);
  });

  it("adds a card's own deck to the note's rather than replacing it", () => {
    const cards = parseCards("#flashcards/db\n\na::b\n\n#flashcards/dbt c::d\n");

    expect(cards.map((card) => card.decks)).toEqual([["db"], ["db", "dbt"]]);
  });

  it("takes the card's own tags off the question", () => {
    const cards = parseCards("#flashcards/db\n\n#flashcards/dbt How does it relate?::so\n");

    expect(cards[0]?.front).toBe("How does it relate?");
    expect(cards[0]?.back).toBe("so");
  });

  it("takes them off the front of a card written over several lines", () => {
    const card = only("#flashcards/dbt How does it relate?\n?\nso\n");

    expect(card.front).toBe("How does it relate?");
    expect(card.decks).toEqual(["dbt"]);
  });

  it("leaves a card in a note nobody tagged in no deck at all", () => {
    expect(only("a::b\n").decks).toEqual([]);
  });

  it("reads no deck out of a fenced tag", () => {
    expect(only("```\n#flashcards/db\n```\n\na::b\n").decks).toEqual([]);
  });
});

describe("parseCards on a parked card", () => {
  const PARKED = `#flashcards/aws

What is a VPC?::A private cloud

What is Direct Connect?::A private link !suspended <!--SR:!2026-08-20,4,270-->

The three storage classes
?
Standard, Infrequent Access, Glacier
!suspended
`;

  it("keeps the card in the note's order rather than dropping it", () => {
    const cards = parseCards(PARKED);
    expect(cards.map((card) => card.front)).toEqual([
      "What is a VPC?",
      "What is Direct Connect?",
      "The three storage classes",
    ]);
  });

  it("marks the one carrying the token and leaves its neighbour alone", () => {
    const cards = parseCards(PARKED);
    expect(cards.map((card) => card.parked)).toEqual([null, "suspended", "suspended"]);
  });

  it("keeps the token and the comment off the back of a card written on one line", () => {
    expect(parseCards(PARKED)[1]?.back).toBe("A private link");
  });

  it("keeps the token off the back of a card written over several lines", () => {
    expect(parseCards(PARKED)[2]?.back).toBe("Standard, Infrequent Access, Glacier");
  });
});

describe("parseCards on a question with no answer", () => {
  const STUB = `#flashcards/aws

What is a VPC?::A private cloud

What is a moved block?::
`;

  it("keeps it as a card rather than dropping it", () => {
    expect(parseCards(STUB).map((card) => card.front)).toEqual([
      "What is a VPC?",
      "What is a moved block?",
    ]);
  });

  it("parks it by its shape, with an empty back", () => {
    const card = parseCards(STUB)[1];
    expect(card?.parked).toBe("unanswered");
    expect(card?.back).toBe("");
  });

  it("goes on reading a line opening with the divider as no card at all", () => {
    expect(parseCards("#flashcards\n\n::an answer with no question\n")).toEqual([]);
  });
});

describe("readSchedule", () => {
  it("reads the three numbers the comment holds", () => {
    expect(readSchedule("a::b <!--SR:!2026-08-20,4,270-->")).toEqual({
      due: "2026-08-20",
      interval: 4,
      ease: 270,
    });
  });

  it("answers nothing for a line carrying no comment", () => {
    expect(readSchedule("a::b")).toBeNull();
  });
});

describe("appendStub", () => {
  it("puts the question at the end, with a divider and no answer", () => {
    expect(appendStub("#flashcards\n\na::b\n", "What is a moved block?")).toBe(
      "#flashcards\n\na::b\n\nWhat is a moved block?::\n",
    );
  });

  it("leaves exactly one blank line above it, whatever the note ended with", () => {
    for (const ending of ["a::b", "a::b\n", "a::b\n\n\n"]) {
      expect(appendStub(ending, "Q")).toBe("a::b\n\nQ::\n");
    }
  });

  it("adds one card, last, parked for want of an answer", () => {
    const text = "#flashcards\n\na::b\n";
    const before = parseCards(text);
    const after = parseCards(appendStub(text, "Q"));

    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ front: "Q", back: "", parked: "unanswered" });
  });
});

describe("parseCards on a tag that opens no card", () => {
  // The two readers of this format have to agree, and this is the line where
  // they could most easily part: `review.ts` sees the matched lines alone.
  it("reads a tag heading prose as the note's, not a card's", () => {
    const cards = parseCards("#flashcards/db is the deck here.\n\na::b\n\nc::d\n");

    expect(cards.map((card) => card.decks)).toEqual([["db"], ["db"]]);
  });

  it("keeps a card's own tags off its neighbours", () => {
    const cards = parseCards("#flashcards/db\n\n#flashcards/dbt a::b\nc::d\n");

    expect(cards.map((card) => card.decks)).toEqual([["db", "dbt"], ["db"]]);
  });
});

describe("parseCards on a front running over two lines", () => {
  // The one case where the tags cannot be a card's own: `review.ts` sees the
  // matched lines alone and cannot tell this front from a line of prose, so
  // both readers hand the tags to the note.
  it("reads them as the note's, and asks the card without them", () => {
    const cards = parseCards(
      "#flashcards/db What is it,\nthe long way round\n?\nlike this\n\na::b\n",
    );

    expect(cards[0]?.front).toBe("What is it,\nthe long way round");
    expect(cards.map((card) => card.decks)).toEqual([["db"], ["db"]]);
  });
});

describe("#1590 a !suspended inside a one-line comment parks nothing", () => {
  it("#1590 a one-line card keeps the comment on its back and stays in the queue", () => {
    const card = only("#flashcards/x\n\nq::a <!-- !suspended -->\n");
    expect([card.front, card.back, card.parked]).toEqual(["q", "a <!-- !suspended -->", null]);
  });

  it("#1590 a cloze line with the token in a comment stays in the queue", () => {
    const card = only("#flashcards/x\n\n{{c1::a}} <!-- !suspended -->\n");
    expect([card.cloze, card.parked]).toEqual([1, null]);
  });

  it("#1590 a ? card's front line with the token in a comment stays in the queue", () => {
    const card = only("#flashcards/x\n\nq <!-- !suspended -->\n?\na\n");
    expect([card.front, card.back, card.parked]).toEqual(["q <!-- !suspended -->", "a", null]);
  });

  it("#1590 a real token beside a commented one parks the card", () => {
    const card = only("#flashcards/x\n\nq::a <!-- !suspended --> !suspended\n");
    expect([card.back, card.parked]).toEqual(["a <!-- !suspended -->", "suspended"]);
  });

  it("#1590 a comment running past the line's end holds no token", () => {
    const card = only("#flashcards/x\n\nq::a <!-- !suspended\nmore -->\n");
    expect(card.parked).toBeNull();
  });
});

describe("#1939 a schedule comment inside a front ends no question", () => {
  const front = (comment: string) => `#flashcards/x\n\nIs ${comment} a:&#58;b?\n?\nyes\n`;
  const FSRS_FRONT =
    "<!--SR:!fsrs,2026-08-20T00:00:00.000Z,4,3.1,5.2,2,3,0,0,2026-08-16T00:00:00.000Z-->";

  it.each([
    ["an SM-2", "<!--SR:!2026-08-20,4,270-->"],
    ["a cloze", "<!--SR:c1!2026-08-20,4,270-->"],
    ["an FSRS", FSRS_FRONT],
  ])("#1939 reads the ? card whose front holds %s comment, as new", (_, comment) => {
    const cards = parseCards(front(comment), "x.md");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ front: `Is ${comment} a::b?`, back: "yes", held: null });
    expect(cards[0]).toMatchObject({ from: 2, to: 4, cloze: null, decks: ["x"] });
  });

  it("#1939 a rating writes under the back and leaves the front's comment as written", () => {
    const text = front("<!--SR:!2026-08-20,4,270-->");
    const next = { due: "2026-11-13", interval: 1, ease: 250 };
    const written = writeSchedule(text, only(text), next);
    expect(written).toBe(`${text.slice(0, -1)}\n<!--SR:!2026-11-13,1,250-->\n`);
    expect(only(written)).toMatchObject({
      front: "Is <!--SR:!2026-08-20,4,270--> a::b?",
      held: next,
    });
  });

  it("#1939 a front of two lines runs up through the comment on its first", () => {
    const card = only("#flashcards/x\n\nIs <!--SR:!2026-08-20,4,270--> a\nb?\n?\nyes\n");
    expect(card.front).toBe("Is <!--SR:!2026-08-20,4,270--> a\nb?");
  });

  it("#1939 the schedule line of the card above still ends the front under it", () => {
    const text = "#flashcards/x\n\nq1\n?\na1\n<!--SR:!2026-08-20,4,270-->\nq2\n?\na2\n";
    expect(parseCards(text).map((card) => [card.front, card.held?.due ?? null])).toEqual([
      ["q1", "2026-08-20"],
      ["q2", null],
    ]);
  });

  it("#1939 a schedule ending a line over the front still ends it", () => {
    const text = "#flashcards/x\n\nq1\n?\na1 <!--SR:!2026-08-20,4,270-->\nq2\n?\na2\n";
    expect(parseCards(text).map((card) => [card.from, card.front])).toEqual([[5, "q2"]]);
  });
  it("#1939 a schedule inside a fence still ends the front, text after it or not (#680)", () => {
    const text = "#flashcards/x\n\n```\nx <!--SR:!2026-08-20,4,270--> y\nz\n```\n?\nyes\n";
    expect(only(text)).toMatchObject({ from: 4, front: "z\n```" });
  });
});

describe("#1931 a card line of comment openers parses in time that grows with its length", () => {
  const HEAD = "#flashcards/x\n\nq::a ";
  const filled = (unit: string, size: number, tail: string) =>
    HEAD + unit.repeat(size / unit.length).slice(0, size - HEAD.length - tail.length) + tail;
  // Best of five, and 20 ms at least below, so a busy box or a pause in a 3 ms run makes no
  // ratio; a square reads about 4.5 on main, at hundreds of ms.
  const best = (text: string) =>
    Math.min(
      ...[1, 2, 3, 4, 5].map(() => {
        const start = performance.now();
        parseCards(text, "x.md");
        return performance.now() - start;
      }),
    );

  it.each([
    ["unclosed openers", "<!--SR:!fsrs,", ""],
    ["openers with a :: after them", "<!--SR:!fsrs,", " x::y"],
    ["openers with the token after them", "<!--SR:!fsrs,", " !suspended"],
    ["openers whose dashes close none", "<!--a--b", "-->"],
    ["openers each on a line of its own", "<!--SR:x\n", ""],
  ])("#1931 %s: 40,000 characters take under 3 times 20,000", (_, unit, tail) => {
    best(filled(unit, 2_000, tail));
    const ratio = best(filled(unit, 40_000, tail)) / Math.max(best(filled(unit, 20_000, tail)), 20);
    expect(ratio).toBeLessThan(3);
  });
});
