import type { Mention } from "@/lib/api";
import { linkMention, mentionLinkText } from "@/lib/mention-link";
import { wikiLinkPath } from "@/lib/wikilink";

/** A mention of `words` on `text`, at the `nth` place they occur. */
function mention(text: string, words: string, line = 1, name = words, nth = 0): Mention {
  let start = -1;
  for (let seen = 0; seen <= nth; seen += 1) start = text.indexOf(words, start + 1);
  return { path: "index.md", line, text, start, end: start + words.length, name };
}

const PATHS = ["index.md", "reading/borges.md", "kafka.md"];

describe("linkMention", () => {
  it("#424 turns the mention into the link and leaves every other byte alone", () => {
    const note = "# Index\n\nI read borges  today.\t\nlast line";
    const found = mention("I read borges  today.\t", "borges", 3);

    expect(linkMention(note, found, "[[borges]]")).toBe(
      "# Index\n\nI read [[borges]]  today.\t\nlast line",
    );
  });

  it("#424 writes nothing when the line changed since the list was read", () => {
    const found = mention("I read borges today.", "borges", 1);

    expect(linkMention("I read Borges today.", found, "[[borges]]")).toBeNull();
    // The same words a line lower are not the line the offsets point into.
    expect(linkMention("new first line\nI read borges today.", found, "[[borges]]")).toBeNull();
  });

  it("#424 links one of two mentions on a line and leaves the other as it was", () => {
    const line = "borges, and borges again";
    const second = mention(line, "borges", 1, "borges", 1);

    expect(linkMention(line, second, "[[borges]]")).toBe("borges, and [[borges]] again");
  });
});

describe("mentionLinkText", () => {
  it("#424 writes the bare name where the words are the name", () => {
    const found = mention("see kafka here", "kafka");

    expect(mentionLinkText(found, "kafka.md", PATHS)).toBe("[[kafka]]");
  });

  it("#424 keeps the words as an alias where case or an alias made the match", () => {
    expect(mentionLinkText(mention("see Kafka here", "Kafka"), "kafka.md", PATHS)).toBe(
      "[[kafka|Kafka]]",
    );
    expect(mentionLinkText(mention("see Franz here", "Franz", 1, "Franz"), "kafka.md", PATHS)).toBe(
      "[[kafka|Franz]]",
    );
  });

  it("#424 spells the path out where another note shares the name, and it resolves", () => {
    const paths = [...PATHS, "borges.md"];
    const link = mentionLinkText(mention("see borges here", "borges"), "reading/borges.md", paths);

    expect(link).toBe("[[reading/borges|borges]]");
    const inside = link.slice(2, link.indexOf("|"));
    expect(wikiLinkPath(inside, paths)).toBe("reading/borges.md");
  });

  it("#424 drops an alias that would break the link", () => {
    const found = mention("see [kafka] here", "[kafka]", 1, "kafka");

    expect(mentionLinkText(found, "kafka.md", PATHS)).toBe("[[kafka]]");
  });
});
