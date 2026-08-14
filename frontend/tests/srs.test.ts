import {
  type Card,
  nextSchedule,
  parseCards,
  readNoteSchedule,
  readSchedule,
  sameAnswer,
  writeNoteSchedule,
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
