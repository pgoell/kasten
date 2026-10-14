import {
  appendStub,
  type Card,
  nextSchedule,
  parseCards,
  readNoteSchedule,
  readNoteSuspended,
  readSchedule,
  sameAnswer,
  setSuspended,
  writeNoteSchedule,
  writeNoteSuspended,
  writeSchedule,
} from "@/lib/srs";

/** The one card the text holds. A test naming a card and getting none is the failure. */
function only(text: string, at = 0): Card {
  const card = parseCards(text)[at];
  if (card === undefined) throw new Error(`no card ${at} in ${JSON.stringify(text)}`);
  return card;
}

const NOTE = `---
id: 019fd770-e40a-72e7-9abc-2cc62eeaeb19
---
# AWS drills

#flashcards/aws

What does S3 stand for?::Simple Storage Service

The three storage classes worth knowing
?
Standard, Infrequent Access, Glacier
`;

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

describe("nextSchedule", () => {
  const TODAY = "2026-08-13";

  it("starts a card nobody has answered", () => {
    expect(nextSchedule(null, "good", TODAY)).toEqual({
      due: "2026-08-14",
      interval: 1,
      ease: 250,
    });
    expect(nextSchedule(null, "easy", TODAY).interval).toBe(4);
    expect(nextSchedule(null, "hard", TODAY).interval).toBe(1);
    expect(nextSchedule(null, "again", TODAY).interval).toBe(1);
    for (const rating of ["again", "hard", "good", "easy"] as const) {
      expect(nextSchedule(null, rating, TODAY).ease).toBe(250);
    }
  });

  const held = { due: TODAY, interval: 4, ease: 250 };

  it("multiplies by the ease on good, leaving the ease alone", () => {
    expect(nextSchedule(held, "good", TODAY)).toEqual({
      due: "2026-08-23",
      interval: 10,
      ease: 250,
    });
  });

  it("takes 15 off the ease on hard and grows the interval by a fifth", () => {
    expect(nextSchedule(held, "hard", TODAY)).toMatchObject({ interval: 5, ease: 235 });
  });

  it("adds 15 to the ease on easy before multiplying, then adds the bonus", () => {
    // 4 × 2.65 × 1.3, rounded.
    expect(nextSchedule(held, "easy", TODAY)).toMatchObject({ interval: 14, ease: 265 });
  });

  it("halves the interval on again and takes 20 off the ease", () => {
    expect(nextSchedule(held, "again", TODAY)).toMatchObject({ interval: 2, ease: 230 });
  });

  it("never lets an interval fall below a day", () => {
    expect(nextSchedule({ due: TODAY, interval: 1, ease: 250 }, "again", TODAY).interval).toBe(1);
  });

  it("never lets the ease fall below 130", () => {
    const sunk = { due: TODAY, interval: 10, ease: 140 };
    expect(nextSchedule(sunk, "again", TODAY).ease).toBe(130);
    expect(nextSchedule({ ...sunk, ease: 130 }, "hard", TODAY).ease).toBe(130);
  });

  it("counts the days forward over the end of a month", () => {
    expect(nextSchedule(null, "easy", "2026-08-30").due).toBe("2026-09-03");
    expect(nextSchedule(null, "good", "2026-12-31").due).toBe("2027-01-01");
  });
});

describe("writeSchedule", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };

  it("puts a comment on the end of a card written on one line", () => {
    const text = "# Deck\n\na::b\n";
    expect(writeSchedule(text, only(text), next)).toBe(
      "# Deck\n\na::b <!--SR:!2026-09-01,7,250-->\n",
    );
  });

  it("puts a comment under a card written over several lines", () => {
    const text = "q\n?\nr\n";
    expect(writeSchedule(text, only(text), next)).toBe("q\n?\nr\n<!--SR:!2026-09-01,7,250-->\n");
  });

  it("replaces the comment a card already carries rather than adding a second", () => {
    const inline = "a::b <!--SR:!2026-08-01,2,240-->\n";
    expect(writeSchedule(inline, only(inline), next)).toBe("a::b <!--SR:!2026-09-01,7,250-->\n");
    const multi = "q\n?\nr\n<!--SR:!2026-08-01,2,240-->\n";
    expect(writeSchedule(multi, only(multi), next)).toBe("q\n?\nr\n<!--SR:!2026-09-01,7,250-->\n");
  });

  it("leaves every other line of the note exactly as it was", () => {
    const card = only(NOTE);
    const written = writeSchedule(NOTE, card, next).split("\n");
    const before = NOTE.split("\n");
    for (const [at, line] of before.entries()) {
      if (at === card.from) continue;
      expect(written[at]).toBe(line);
    }
  });
});

describe("sameAnswer", () => {
  it("forgives space, case and a trailing stop", () => {
    expect(sameAnswer("  simple storage service ", "Simple Storage Service")).toBe(true);
    expect(sameAnswer("Simple  Storage\tService", "Simple Storage Service")).toBe(true);
    expect(sameAnswer("Simple Storage Service", "Simple Storage Service.")).toBe(true);
  });

  it("does not forgive a different word", () => {
    expect(sameAnswer("Simple Store Service", "Simple Storage Service")).toBe(false);
    expect(sameAnswer("", "Simple Storage Service")).toBe(false);
  });
});

describe("readNoteSchedule", () => {
  it("reads the three fields off the frontmatter", () => {
    const note = "---\nid: 1\nsr-due: 2026-08-20\nsr-interval: 4\nsr-ease: 270\n---\n# TLS\n";
    expect(readNoteSchedule(note)).toEqual({ due: "2026-08-20", interval: 4, ease: 270 });
  });

  it("answers nothing where the note carries none of them", () => {
    expect(readNoteSchedule("---\nid: 1\n---\n# TLS\n")).toBeNull();
  });

  it("takes a due date written by hand as a card nothing has answered", () => {
    expect(readNoteSchedule("---\nsr-due: 2026-08-20\n---\n")).toEqual({
      due: "2026-08-20",
      interval: 1,
      ease: 250,
    });
  });
});

describe("writeNoteSchedule", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 265 };

  it("sets the three fields, keeping the ones already there", () => {
    const note = "---\nid: 1\n---\n# TLS\n\nbody\n";
    expect(writeNoteSchedule(note, next)).toBe(
      "---\nid: 1\nsr-due: 2026-09-01\nsr-interval: 7\nsr-ease: 265\n---\n# TLS\n\nbody\n",
    );
  });

  it("mints a block for a note that has none, keeping the body whole", () => {
    expect(writeNoteSchedule("# TLS\n\nbody\n", next)).toBe(
      "---\nsr-due: 2026-09-01\nsr-interval: 7\nsr-ease: 265\n---\n# TLS\n\nbody\n",
    );
  });

  it("moves a schedule the note already carried rather than adding a second", () => {
    const note = "---\nsr-due: 2026-01-01\nsr-interval: 1\nsr-ease: 250\n---\n# TLS\n";
    const written = writeNoteSchedule(note, next);
    expect(written.match(/sr-due:/g)).toHaveLength(1);
    expect(written).toContain("sr-due: 2026-09-01");
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

describe("parseCards on an imported question holding `::`", () => {
  // The text `as_note` writes in `backend/tests/test_anki.py`: on one line the
  // first `::` would cut the question at `What does std`.
  it("reads back the whole question and the answer", () => {
    const cards = parseCards(
      "#flashcards/French\n\nWhat does std::move do?\n?\ncasts to an rvalue\n",
      "French",
    );

    expect(cards.map(({ front, back, decks }) => ({ front, back, decks }))).toEqual([
      { front: "What does std::move do?", back: "casts to an rvalue", decks: ["French"] },
    ]);
  });

  it("keeps its one-line neighbours apart from it when the answer holds `::` too", () => {
    const cards = parseCards(
      "#flashcards/x\n\na::b\n\nWhat does std::move do?\n?\ncasts std::move\n\nc::d\n",
    );

    expect(cards.map(({ front, back }) => [front, back])).toEqual([
      ["a", "b"],
      ["What does std::move do?", "casts std::move"],
      ["c", "d"],
    ]);
  });
});

describe("parseCards on an imported deck keeping its formatting", () => {
  // `COUNTED_NOTE` in `backend/tests/test_anki.py`, which `card_count` counts
  // as five: the import's count has to be what the sitting reads.
  const note = [
    "#flashcards/French",
    "",
    "Name three",
    "colours",
    "?",
    "- red",
    "- green",
    "",
    "漢字::<ruby>漢字<rt>かんじ</rt></ruby>",
    "",
    "{{c1::Paris}} is in {{c2::France}}",
    "?",
    "On the",
    "Seine",
    "",
    "What does std::size count?",
    "?",
    "\\# of elements",
    "\\!suspended no",
    "",
  ].join("\n");

  it("reads as many cards as the import counts, each side whole", () => {
    const cards = parseCards(note, "French");

    expect(cards).toHaveLength(5);
    expect(cards.map(({ front, back, cloze }) => (cloze === null ? [front, back] : cloze))).toEqual(
      [
        ["Name three\ncolours", "- red\n- green"],
        ["漢字", "<ruby>漢字<rt>かんじ</rt></ruby>"],
        1,
        2,
        ["What does std::size count?", "\\# of elements\n\\!suspended no"],
      ],
    );
    expect(cards[2]?.back.endsWith("\n\nOn the\nSeine")).toBe(true);
    expect(cards.every((card) => card.parked === null)).toBe(true);
  });

  it("asks a cloze over ruby for the word, its reading no part of the answer", () => {
    const [card] = parseCards("#flashcards/x\n\n{{c1::<ruby>漢字<rt>かんじ</rt></ruby>}}を読む\n");

    expect(card?.target).toBe("漢字");
    expect(sameAnswer("漢字", card?.target ?? "")).toBe(true);
  });

  it("parks no card whose answer names the escaped token mid-line", () => {
    const [card] = parseCards("#flashcards/x\n\nQ::type x \\!suspended there\n");

    expect(card?.parked).toBeNull();
    expect(card?.back).toBe("type x \\!suspended there");
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

describe("readNoteSuspended", () => {
  it("reads the field as true only for the word", () => {
    expect(readNoteSuspended("---\nsr-suspended: true\n---\n# TLS\n")).toBe(true);
  });

  it("is false where the field says so", () => {
    expect(readNoteSuspended("---\nsr-suspended: false\n---\n# TLS\n")).toBe(false);
  });

  it("is false where the note carries no such field", () => {
    expect(readNoteSuspended("---\nid: 1\n---\n# TLS\n")).toBe(false);
  });
});

describe("writeNoteSuspended", () => {
  it("writes a note the reader takes as suspended", () => {
    const written = writeNoteSuspended("---\nid: 1\n---\n# TLS\n", true);
    expect(readNoteSuspended(written)).toBe(true);
  });

  it("leaves the note's schedule where it was", () => {
    const note = "---\nsr-due: 2026-08-20\nsr-interval: 4\nsr-ease: 250\n---\n# TLS\n";
    const written = writeNoteSuspended(note, true);
    expect(written).toContain("sr-due: 2026-08-20");
    expect(readNoteSchedule(written)).toEqual({ due: "2026-08-20", interval: 4, ease: 250 });
  });

  it("sets the field to false rather than taking it out", () => {
    const written = writeNoteSuspended("---\nsr-suspended: true\n---\n# TLS\n", false);
    expect(written).toContain("sr-suspended: false");
    expect(readNoteSuspended(written)).toBe(false);
  });
});

describe("setSuspended", () => {
  const INLINE_HELD = "a::b <!--SR:!2026-08-20,4,270-->\n";
  const INLINE_FRESH = "a::b\n";
  const MULTI_HELD = "q\n?\nr\n<!--SR:!2026-08-14,1,230-->\n";
  const MULTI_FRESH = "q\n?\nr\n";

  /** Park it, read the note back, and put it back. */
  function roundTrip(text: string): string {
    const parked = setSuspended(text, only(text), true);
    return setSuspended(parked, only(parked), false);
  }

  it("puts the token between the answer and the comment on a one-line card", () => {
    expect(setSuspended(INLINE_HELD, only(INLINE_HELD), true)).toBe(
      "a::b !suspended <!--SR:!2026-08-20,4,270-->\n",
    );
  });

  it("puts it on the end of a one-line card carrying no comment", () => {
    expect(setSuspended(INLINE_FRESH, only(INLINE_FRESH), true)).toBe("a::b !suspended\n");
  });

  it("puts it at the head of the schedule's line on a card written over several", () => {
    expect(setSuspended(MULTI_HELD, only(MULTI_HELD), true)).toBe(
      "q\n?\nr\n!suspended <!--SR:!2026-08-14,1,230-->\n",
    );
  });

  it("splices a line of its own under a card that has no schedule yet", () => {
    expect(setSuspended(MULTI_FRESH, only(MULTI_FRESH), true)).toBe("q\n?\nr\n!suspended\n");
  });

  it("leaves the note byte-identical after parking and putting back", () => {
    for (const text of [INLINE_HELD, INLINE_FRESH, MULTI_HELD, MULTI_FRESH]) {
      expect(roundTrip(text)).toBe(text);
    }
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

describe("parseCards on a cloze", () => {
  const CLOZE = "#flashcards/geo\n\nThe capital of {{c1::France}} is {{c2::Paris::a city}}.\n";

  it("asks one card per number, hiding its text and showing the others plain", () => {
    const cards = parseCards(CLOZE);

    expect(cards.map((card) => [card.cloze, card.front, card.back])).toEqual([
      [1, "The capital of \\[...\\] is Paris.", "The capital of ==France== is Paris."],
      [2, "The capital of France is \\[a city\\].", "The capital of France is ==Paris==."],
    ]);
    expect(cards.map((card) => [card.from, card.inline, card.decks, card.parked])).toEqual([
      [2, true, ["geo"], null],
      [2, true, ["geo"], null],
    ]);
  });

  it("reads the cloze before the divider, a `::` outside the marks included", () => {
    const cards = parseCards("#flashcards\n\nA {{c1::b}} with c::d after it\n");

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ cloze: 1, front: "A \\[...\\] with c::d after it" });
  });

  it("asks two marks of one number as one card, hidden and shown together", () => {
    const cards = parseCards("#flashcards\n\nWater is {{c1::H}}2{{c1::O}}.\n");

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      front: "Water is \\[...\\]2\\[...\\].",
      back: "Water is ==H==2==O==.",
      target: "H, O",
    });
  });

  it("keeps each number's schedule apart, off its own labelled comment", () => {
    const text =
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c2!2026-08-15,1,250--> <!--SR:c1!2026-08-20,4,270-->\n";
    const [one, two] = parseCards(text);

    expect(one?.held).toEqual({ due: "2026-08-20", interval: 4, ease: 270 });
    expect(two?.held).toEqual({ due: "2026-08-15", interval: 1, ease: 250 });
    expect(one?.front).toBe("\\[...\\] b");
  });

  it("reads the line above a `?` as a cloze with its back under the answer", () => {
    const text =
      "#flashcards\n\nThe capital of France is {{c1::Paris}}.\n?\nOn the Seine.\n<!--SR:c1!2026-08-20,4,270-->\n";
    const cards = parseCards(text);

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      cloze: 1,
      inline: false,
      front: "The capital of France is \\[...\\].",
      back: "The capital of France is ==Paris==.\n\nOn the Seine.",
      held: { due: "2026-08-20", interval: 4, ease: 270 },
      from: 2,
      to: 5,
    });
  });

  it("reads a marked front line further up a `?` as a cloze of its own", () => {
    const cards = parseCards("#flashcards\n\n{{c1::A}} first\n{{c1::B}} second\n?\nextra\n");

    expect(cards.map((card) => [card.from, card.inline, card.front])).toEqual([
      [2, true, "\\[...\\] first"],
      [3, false, "\\[...\\] second"],
    ]);
  });

  it("reads no cloze inside a fence, and none in a note nobody tagged", () => {
    expect(parseCards("#flashcards\n\n```\n{{c1::a}}\n```\n")).toEqual([]);
    expect(parseCards("{{c1::a}} {{c2::b}}\n").map((card) => card.decks)).toEqual([[], []]);
  });

  it("parks every number off the token on its line, and never as unanswered", () => {
    const cards = parseCards("#flashcards\n\n{{c1::a}} {{c2::b}} !suspended\n{{c1::c}}::\n");

    expect(cards.map((card) => card.parked)).toEqual(["suspended", "suspended", null]);
  });
});

describe("writeSchedule on a cloze", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };

  it("adds only the number rated, leaving the other with none", () => {
    const text = "#flashcards\n\n{{c1::a}} {{c2::b}}\n";
    const two = parseCards(text)[1] as Card;

    expect(writeSchedule(text, two, next)).toBe(
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c2!2026-09-01,7,250-->\n",
    );
  });

  it("rewrites its own comment and leaves the other number's untouched", () => {
    const text =
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-08-01,2,240--> <!--SR:c2!2026-08-15,1,250-->\n";
    const one = parseCards(text)[0] as Card;

    expect(writeSchedule(text, one, next)).toBe(
      "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-09-01,7,250--> <!--SR:c2!2026-08-15,1,250-->\n",
    );
  });

  it("rewrites the comment in place when one number is rated twice", () => {
    const text = "#flashcards\n\n{{c1::a}} {{c2::b}}\n";
    const once = writeSchedule(text, parseCards(text)[0] as Card, next);
    const twice = writeSchedule(once, parseCards(once)[0] as Card, {
      due: "2026-09-02",
      interval: 1,
      ease: 230,
    });

    expect(twice).toBe("#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-09-02,1,230-->\n");
  });

  it("puts a `?` cloze's comments on the line under its back, one line for all", () => {
    const text = "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n";
    const first = writeSchedule(text, parseCards(text)[1] as Card, next);

    expect(first).toBe(
      "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n<!--SR:c2!2026-09-01,7,250-->\n",
    );
    expect(writeSchedule(first, parseCards(first)[0] as Card, next)).toBe(
      "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n<!--SR:c2!2026-09-01,7,250--> <!--SR:c1!2026-09-01,7,250-->\n",
    );
  });
});

describe("a cloze beside the other card forms", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };
  const MIXED = `#flashcards

a::b <!--SR:!2026-08-01,2,240-->
{{c1::x}} <!--SR:c1!2026-08-20,4,270-->

q
?
r
<!--SR:!2026-08-14,1,230-->

{{c1::y}} {{c2::z}}
?
extra
<!--SR:c1!2026-08-21,4,270-->
`;

  it("rates every plain card to exactly the bytes it gave before", () => {
    const [inline, cloze, multi] = parseCards(MIXED);
    expect(inline?.cloze).toBeNull();
    expect(cloze?.cloze).toBe(1);
    expect(multi?.cloze).toBeNull();

    expect(writeSchedule(MIXED, inline as Card, next)).toBe(`#flashcards

a::b <!--SR:!2026-09-01,7,250-->
{{c1::x}} <!--SR:c1!2026-08-20,4,270-->

q
?
r
<!--SR:!2026-08-14,1,230-->

{{c1::y}} {{c2::z}}
?
extra
<!--SR:c1!2026-08-21,4,270-->
`);
    expect(writeSchedule(MIXED, multi as Card, next)).toBe(`#flashcards

a::b <!--SR:!2026-08-01,2,240-->
{{c1::x}} <!--SR:c1!2026-08-20,4,270-->

q
?
r
<!--SR:!2026-09-01,7,250-->

{{c1::y}} {{c2::z}}
?
extra
<!--SR:c1!2026-08-21,4,270-->
`);
    // And the other way: rating the cloze leaves both plain cards' lines alone.
    expect(writeSchedule(MIXED, cloze as Card, next)).toBe(
      MIXED.replace(
        "{{c1::x}} <!--SR:c1!2026-08-20,4,270-->",
        "{{c1::x}} <!--SR:c1!2026-09-01,7,250-->",
      ),
    );
  });

  it("never reads a neighbour's comment of the other kind as its own", () => {
    const cards = parseCards(MIXED);

    expect(cards.map((card) => [card.cloze, card.held?.due ?? null])).toEqual([
      [null, "2026-08-01"],
      [1, "2026-08-20"],
      [null, "2026-08-14"],
      [1, "2026-08-21"],
      [2, null],
    ]);
  });
});

describe("a `?` cloze whose schedule line holds a plain comment", () => {
  // A `?` card from main whose front happens to hold a mark.
  const PLAIN = "#flashcards\nThe {{c1::A}} b\n?\nback\n<!--SR:!2026-10-01,1,250-->";

  it("parks on that line, and puts back to the same bytes", () => {
    const on = setSuspended(PLAIN, only(PLAIN), true);

    expect(on).toBe(
      "#flashcards\nThe {{c1::A}} b\n?\nback\n!suspended <!--SR:!2026-10-01,1,250-->",
    );
    expect(only(on).parked).toBe("suspended");
    expect(setSuspended(on, only(on), false)).toBe(PLAIN);
  });

  it("adds its labelled comment on that line, the plain one left as it was", () => {
    expect(writeSchedule(PLAIN, only(PLAIN), { due: "2026-09-01", interval: 7, ease: 250 })).toBe(
      "#flashcards\nThe {{c1::A}} b\n?\nback\n<!--SR:!2026-10-01,1,250--> <!--SR:c1!2026-09-01,7,250-->",
    );
  });
});

describe("setSuspended on a cloze", () => {
  const ONE_LINE = "#flashcards\n\n{{c1::a}} {{c2::b}} <!--SR:c1!2026-08-20,4,270-->\n";
  const UNDER = "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n<!--SR:c2!2026-08-20,4,270-->\n";
  const BARE = "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n";

  it("parks every number off one token, and one put back restores them all", () => {
    for (const [text, parked] of [
      [ONE_LINE, "#flashcards\n\n{{c1::a}} {{c2::b}} !suspended <!--SR:c1!2026-08-20,4,270-->\n"],
      [
        UNDER,
        "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n!suspended <!--SR:c2!2026-08-20,4,270-->\n",
      ],
      [BARE, "#flashcards\n\n{{c1::a}} {{c2::b}}\n?\nextra\n!suspended\n"],
    ] as const) {
      const on = setSuspended(text, parseCards(text)[0] as Card, true);
      expect(on).toBe(parked);
      expect(parseCards(on).map((card) => card.parked)).toEqual(["suspended", "suspended"]);
      // Put back through the other number: one token, so either one lifts it.
      expect(setSuspended(on, parseCards(on)[1] as Card, false)).toBe(text);
    }
  });
});

describe("an imported card carrying its anki id", () => {
  const next = { due: "2026-09-01", interval: 7, ease: 250 };
  const INLINE =
    "#flashcards\n\nWhat is S3?::Simple Storage <!--anki:1700000000000:0:0a1b2c3d-->\nx::y\n";
  const CLOZE = "#flashcards\n\nThe capital is {{c1::Paris}}. <!--anki:5:0:0a1b2c3d-->\nx::y\n";
  const MULTI =
    "#flashcards\n\nFront\n?\nBack line one\nBack line two <!--anki:7:1:0a1b2c3d-->\n\nx::y\n";

  /** Rate it, park it, put it back: the three notes written along the way. */
  function sit(text: string) {
    const rated = writeSchedule(text, only(text), next);
    const parked = setSuspended(rated, only(rated), true);
    return { rated, parked, back: setSuspended(parked, only(parked), false) };
  }

  it("never shows the id on either side, and a typed answer matches without it", () => {
    expect(only(INLINE)).toMatchObject({ front: "What is S3?", back: "Simple Storage" });
    expect(sameAnswer("simple storage", only(INLINE).back)).toBe(true);

    expect(only(CLOZE)).toMatchObject({
      front: "The capital is \\[...\\].",
      back: "The capital is ==Paris==.",
      target: "Paris",
    });
    expect(sameAnswer("paris", only(CLOZE).target ?? "")).toBe(true);

    expect(only(MULTI)).toMatchObject({ front: "Front", back: "Back line one\nBack line two" });
    expect(sameAnswer("Back line one Back line two", only(MULTI).back)).toBe(true);

    const extra = "#flashcards\n\n{{c1::a}}\n?\nextra <!--anki:9:0:0a1b2c3d-->\n";
    expect(only(extra).back).toBe("==a==\n\nextra");
  });

  it("keeps the id byte for byte through a rating and a park on a one-line card", () => {
    const { rated, parked, back } = sit(INLINE);

    expect(rated).toBe(
      "#flashcards\n\nWhat is S3?::Simple Storage <!--anki:1700000000000:0:0a1b2c3d--> <!--SR:!2026-09-01,7,250-->\nx::y\n",
    );
    expect(parked).toBe(
      "#flashcards\n\nWhat is S3?::Simple Storage <!--anki:1700000000000:0:0a1b2c3d--> !suspended <!--SR:!2026-09-01,7,250-->\nx::y\n",
    );
    expect(back).toBe(rated);
    expect(only(parked)).toMatchObject({ back: "Simple Storage", held: next, parked: "suspended" });
    expect(only(back)).toMatchObject({ back: "Simple Storage", held: next, parked: null });
  });

  it("keeps the id byte for byte through a rating and a park on a cloze line", () => {
    const { rated, parked, back } = sit(CLOZE);

    expect(rated).toBe(
      "#flashcards\n\nThe capital is {{c1::Paris}}. <!--anki:5:0:0a1b2c3d--> <!--SR:c1!2026-09-01,7,250-->\nx::y\n",
    );
    expect(parked).toBe(
      "#flashcards\n\nThe capital is {{c1::Paris}}. <!--anki:5:0:0a1b2c3d--> !suspended <!--SR:c1!2026-09-01,7,250-->\nx::y\n",
    );
    expect(back).toBe(rated);
    expect(only(parked)).toMatchObject({
      back: "The capital is ==Paris==.",
      held: next,
      parked: "suspended",
    });
    expect(only(back)).toMatchObject({
      back: "The capital is ==Paris==.",
      held: next,
      parked: null,
    });
  });

  it("keeps the id byte for byte through a rating and a park on a `?` card", () => {
    const { rated, parked, back } = sit(MULTI);

    expect(rated).toBe(
      "#flashcards\n\nFront\n?\nBack line one\nBack line two <!--anki:7:1:0a1b2c3d-->\n<!--SR:!2026-09-01,7,250-->\n\nx::y\n",
    );
    expect(parked).toBe(
      "#flashcards\n\nFront\n?\nBack line one\nBack line two <!--anki:7:1:0a1b2c3d-->\n!suspended <!--SR:!2026-09-01,7,250-->\n\nx::y\n",
    );
    expect(back).toBe(rated);
    const shown = { front: "Front", back: "Back line one\nBack line two", held: next };
    expect(only(parked)).toMatchObject({ ...shown, parked: "suspended" });
    expect(only(back)).toMatchObject({ ...shown, parked: null });
  });
});
