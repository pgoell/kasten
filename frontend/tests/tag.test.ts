import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { Tag, tagCompletions, vaultTags } from "@/lib/tag";

const TAGS = ["#databases", "#dbt", "#flashcards/databases"];

/** What the editor offers with the caret at the end of `doc`, or at `pos`. */
function complete(doc: string, tags?: string[], explicit = false, pos = doc.length) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [Tag] }),
      ...(tags ? [vaultTags.of(tags)] : []),
    ],
  });

  return tagCompletions(new CompletionContext(state, pos, explicit));
}

describe("tagCompletions", () => {
  it("offers the whole vocabulary once a hash is opened mid-line", () => {
    const result = complete("about #", TAGS);

    expect(result?.options.map(({ label }) => label)).toEqual(TAGS);
  });

  it("completes from the hash, so the labels are scored whole", () => {
    const result = complete("about #db", TAGS);

    expect(result?.from).toBe("about ".length);
    expect(result?.options).toHaveLength(TAGS.length);
  });

  it("holds off on a bare hash starting a line, which is a heading being typed", () => {
    expect(complete("#", TAGS)).toBeNull();
    expect(complete("  #", TAGS)).toBeNull();
  });

  it("offers on that hash once a letter follows it, which no heading has", () => {
    // The vault writes `#flashcards/aws` at the start of a line, so refusing
    // the line outright would refuse the tag most worth completing.
    expect(complete("#f", TAGS)?.options).toHaveLength(TAGS.length);
  });

  it("offers on an explicit ask, wherever the caret is", () => {
    expect(complete("#", TAGS, true)?.options).toHaveLength(TAGS.length);
  });

  it("offers nothing where a hash is not a tag", () => {
    expect(complete("note#", TAGS)).toBeNull();
  });

  it("offers nothing where the vocabulary is not known", () => {
    expect(complete("about #db")).toBeNull();
  });
});
