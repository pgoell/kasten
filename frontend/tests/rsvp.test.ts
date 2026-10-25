import {
  anchorAt,
  back,
  chunkEnd,
  DEFAULT_SETTINGS,
  delay,
  findQuote,
  forward,
  indexAt,
  orp,
  placeAt,
  resume,
  settingsOf,
  type Word,
  wordsOf,
} from "@/lib/rsvp";

function plain(text: string): Word[] {
  return wordsOf([{ text, from: 0 }], 0);
}

describe("wordsOf", () => {
  it("splits on whitespace and keeps each word's offset", () => {
    const words = plain("One  two\nthree");
    expect(words.map((word) => [word.text, word.offset])).toEqual([
      ["One", 0],
      ["two", 5],
      ["three", 9],
    ]);
  });

  it("marks sentence ends, closing quotes included, and not abbreviations", () => {
    const words = plain('He said "go." Mr. Smith left e.g. now! Done');
    expect(words.filter((word) => word.sentence).map((word) => word.text)).toEqual([
      '"go."',
      "now!",
      "Done",
    ]);
  });

  it("ends a paragraph at a blank line, a break and the end", () => {
    const words = wordsOf([{ text: "a b\nc\n\nd", from: 0 }, "break", { text: "e", from: 10 }], 2);
    expect(words.filter((word) => word.paragraph).map((word) => word.text)).toEqual([
      "c",
      "d",
      "e",
    ]);
    expect(words.every((word) => word.section === 2)).toBe(true);
    // A paragraph's end is a sentence's end too.
    expect(words.find((word) => word.text === "c")?.sentence).toBe(true);
  });

  it("ends a paragraph at every line end when told lines are blocks", () => {
    const words = wordsOf([{ text: "a\nb", from: 0 }], 0, true);
    expect(words.map((word) => word.paragraph)).toEqual([true, true]);
  });

  it("runs a word across two runs with no space between them", () => {
    const words = wordsOf(
      [
        { text: "bo", from: 2 },
        { text: "ld word", from: 6 },
      ],
      0,
    );
    expect(words.map((word) => [word.text, word.offset])).toEqual([
      ["bold", 2],
      ["word", 9],
    ]);
  });
});

describe("chunkEnd", () => {
  const words = plain("one two three. four five");

  it("takes up to the size", () => {
    expect(chunkEnd(words, 3, 3)).toBe(5);
    expect(chunkEnd(words, 0, 1)).toBe(1);
  });

  it("stops at a sentence end", () => {
    expect(chunkEnd(words, 1, 3)).toBe(3);
  });
});

describe("orp", () => {
  it("fixes a letter a little left of the middle", () => {
    expect(orp("a")).toBe(0);
    expect(orp("word")).toBe(1);
    expect(orp("reading")).toBe(2);
    expect(orp("understanding")).toBe(3);
    expect(orp("incomprehensibilities")).toBe(4);
  });

  it("counts past a leading quote", () => {
    expect(orp('"word"')).toBe(2);
  });
});

describe("delay", () => {
  const words = plain("one, two. three\n\nfour five");
  const settings = { wpm: 600, pause: 1 };

  it("gives each word its time and pauses after punctuation", () => {
    expect(delay(words, 3, 4, settings)).toBe(100);
    expect(delay(words, 0, 1, settings)).toBe(150);
    expect(delay(words, 1, 2, settings)).toBe(200);
    expect(delay(words, 2, 3, settings)).toBe(300);
  });

  it("counts every word of a chunk", () => {
    expect(delay(words, 0, 2, { wpm: 600, pause: 0 })).toBe(200);
  });
});

describe("sentences and paragraphs", () => {
  // 0 One. | 1 Two 2 three. | 3 Four. (paragraph) | 4 Five.
  const words = plain("One. Two three. Four.\n\nFive.");

  it("goes back to the sentence's start, then the one before", () => {
    expect(back(words, 2, "sentence")).toBe(1);
    expect(back(words, 1, "sentence")).toBe(0);
    expect(back(words, 0, "sentence")).toBe(0);
  });

  it("goes forward to the next sentence and paragraph", () => {
    expect(forward(words, 1, "sentence")).toBe(3);
    expect(forward(words, 0, "paragraph")).toBe(4);
    expect(forward(words, 4, "paragraph")).toBe(4);
  });

  it("goes back a paragraph", () => {
    expect(back(words, 4, "paragraph")).toBe(0);
    expect(back(words, 2, "paragraph")).toBe(0);
  });
});

describe("resume", () => {
  const words = plain("a b c d e f g h a b c d e f");

  it("starts at the top with nothing saved", () => {
    expect(resume(null, words)).toBe(0);
  });

  it("takes the saved index when the text is the same", () => {
    expect(resume(placeAt(words, 3), words)).toBe(3);
  });

  it("finds the saved words nearest the saved index once the text changed", () => {
    const place = placeAt(words, 8);
    expect(place.anchor).toBe("a b c d e");
    const changed = plain("x y a b c d e f g h a b c d e f");
    expect(resume(place, changed)).toBe(10);
  });

  it("finds a place near the end once words are added after it", () => {
    // Saved within the last four words, so its anchor holds fewer than five.
    const place = placeAt(words, 12);
    expect(place.anchor).toBe("e f");
    const longer = plain("a b c d e f g h a b c d e f g h i");
    expect(resume(place, longer)).toBe(12);
  });

  it("starts at the top when the saved words are gone", () => {
    const place = { word: 2, words: 99, anchor: "no such words here" };
    expect(resume(place, words)).toBe(0);
  });

  it("joins the saved word and four after it", () => {
    expect(anchorAt(words, 12)).toBe("e f");
  });
});

describe("finding a place", () => {
  const words = wordsOf([{ text: "alpha beta gamma", from: 10 }, "break"], 1);

  it("lands in the word the point falls in, or the next", () => {
    expect(indexAt(words, 1, 12)).toBe(0);
    expect(indexAt(words, 1, 16)).toBe(1);
    expect(indexAt(words, 0, 99)).toBe(0);
    expect(indexAt(words, 1, 99)).toBe(2);
  });

  it("finds a selection, cut words and all", () => {
    expect(findQuote(words, "ta gam")).toBe(1);
    expect(findQuote(words, "amm")).toBe(2);
    expect(findQuote(words, "delta")).toBeNull();
  });
});

describe("settingsOf", () => {
  it("falls back and clamps", () => {
    expect(settingsOf(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsOf({ wpm: 5000, chunk: 2.6, size: "big", pause: -1 })).toEqual({
      wpm: 1000,
      chunk: 3,
      size: DEFAULT_SETTINGS.size,
      pause: 0,
    });
  });
});
