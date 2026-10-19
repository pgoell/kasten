import { describe, expect, it } from "vitest";
import { cardTags, deckTags, withoutTags } from "@/lib/deck-tag";
import { noteLanguage } from "@/lib/note-language";
import { parseCards } from "@/lib/srs";
import cases from "@/lib/tag-cases.json";
import { parseTodo, tagsOf } from "@/lib/todo";
import { expandShorthand, matchesFilter, parseFilter } from "@/lib/todo-shorthand";
import { parseViews } from "@/lib/todo-view";

// docs/reference/tag-format.md: every reader runs the whole table, a reader of
// one line the cases of one line. One expect per reader, so a run on main shows
// every case it gets wrong at once.

type Case = (typeof cases)[number];

/**
 * kasten's markdown under its frontmatter, as the editor parses a note. The
 * frontmatter wrapper is what keeps a hash in the block from drawing as a tag.
 */
const notes = noteLanguage().language.parser;

/** The tags the editor's parser draws in `text`, in order. */
function drawn(text: string): string[] {
  const tags: string[] = [];
  notes.parse(text).iterate({
    enter(node) {
      if (node.name === "Tag") tags.push(text.slice(node.from, node.to));
    },
  });
  return tags;
}

const lines = cases.filter((one) => !one.text.includes("\n"));

/** Each case's id beside what `read` makes of it. */
function table<T>(of: Case[], read: (one: Case) => T): Record<string, T> {
  return Object.fromEntries(of.map((one) => [one.id, read(one)]));
}

/** The decks a list of tags names, a bare `#flashcards` being "". */
function decksOf(tags: string[]): string[] {
  return tags.flatMap((tag) => {
    const deck = /^#flashcards(?:\/(.*))?$/u.exec(tag);
    return deck === null ? [] : [deck[1] ?? ""];
  });
}

describe("#640 every frontend reader runs the tag table", () => {
  it("#640 A3 the editor's parser draws the tags of every case", () => {
    expect(table(cases, (one) => drawn(one.text))).toEqual(table(cases, (one) => one.tags));
  });

  it("#640 A3 tagsOf reads the tags of every one-line case", () => {
    expect(table(lines, (one) => tagsOf(one.text).map(({ tag }) => tag))).toEqual(
      table(lines, (one) => one.tags),
    );
  });

  it("#640 A3 deckTags reads the deck tags of every one-line case", () => {
    expect(table(lines, (one) => deckTags(one.text))).toEqual(
      table(lines, (one) => decksOf(one.tags)),
    );
  });
});

describe("#653 a comment opening a todo's words is no block", () => {
  it("#653 B a todo and a quick add whose words open with <!-- keep their tags and fields", () => {
    // The box opens the paragraph, so `<!--` after it is an inline comment:
    // the comment block rule is for a reader holding a whole line.
    const todo = parseTodo("- [ ] <!-- x --> #p 📅 2026-10-20");

    expect({
      tags: todo?.tags,
      due: todo?.due,
      quick: expandShorthand("<!-- x --> #p", "2026-10-19").tags,
    }).toEqual({ tags: ["#p"], due: "2026-10-20", quick: ["#p"] });
  });
});

describe("#640 a bracket that makes no link takes no tag", () => {
  it("#640 the parser and tagsOf both read a tag after a bracket that never becomes a link", () => {
    const texts = ["see [ #x", "[draft] #y", "- [ ] call #1on1", "[[a #z"];

    const tags = [["#x"], ["#y"], ["#1on1"], ["#z"]];

    expect({
      drawn: texts.map(drawn),
      read: texts.map((text) => tagsOf(text).map(({ tag }) => tag)),
    }).toEqual({ drawn: tags, read: tags });
  });
});

describe("#640 a tag may start with a digit", () => {
  it("#640 A2 a todo `call #1on1` carries #1on1 and a saved view on it lists it", () => {
    const [view] = parseViews("- one on one: #1on1");
    if (view === undefined) throw new Error("no view in that note");
    const todo = parseTodo("- [ ] call #1on1");
    if (todo === null) throw new Error("not a todo");

    expect.soft(todo.tags).toEqual(["#1on1"]);
    expect(matchesFilter(todo, parseFilter(view.filter), "2026-08-10")).toBe(true);
  });
});

describe("#633 a deck tag ends where the tag ends", () => {
  it("#633 A7 (#flashcards/es) names the deck es", () => {
    expect.soft(deckTags("Spanish words (#flashcards/es)")).toEqual(["es"]);
    expect(parseCards("Spanish words (#flashcards/es)\n\na::b\n")[0]?.decks).toEqual(["es"]);
  });

  it("#633 I4 the head of a card and the deck tags agree, and #flashcardsx names no deck", () => {
    const read = (line: string) => ({
      card: cardTags(line),
      decks: deckTags(line),
      asked: withoutTags(line),
    });

    expect.soft(read("#flashcards/es) q::a")).toEqual({
      card: null,
      decks: ["es"],
      asked: "#flashcards/es) q::a",
    });
    expect(read("#flashcardsx q::a")).toEqual({
      card: null,
      decks: [],
      asked: "#flashcardsx q::a",
    });
  });
});
