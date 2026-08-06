import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { vaultPaths, WikiLink, wikiLinkCompletions, wikiLinkPath } from "@/lib/wikilink";

const PATHS = ["daily/2026-08-05.md", "index.md", "reading/borges.md"];

describe("wikiLinkPath", () => {
  it("takes a name the vault root holds", () => {
    expect(wikiLinkPath("index", PATHS)).toBe("index.md");
  });

  it("finds a note by its name wherever in the vault it sits", () => {
    expect(wikiLinkPath("borges", PATHS)).toBe("reading/borges.md");
  });

  it("ignores case in the name", () => {
    expect(wikiLinkPath("Borges", PATHS)).toBe("reading/borges.md");
  });

  it("prefers the note at the root to one of the same name in a folder", () => {
    expect(wikiLinkPath("borges", ["reading/borges.md", "borges.md"])).toBe("borges.md");
  });

  it("takes the suffix when it is written out", () => {
    expect(wikiLinkPath("borges.md", PATHS)).toBe("reading/borges.md");
  });

  it("trims what is written around the name", () => {
    expect(wikiLinkPath("  borges  ", PATHS)).toBe("reading/borges.md");
  });

  it("names the path a create would make when nothing answers to the name", () => {
    expect(wikiLinkPath("borges the elder", PATHS)).toBe("borges the elder.md");
  });

  // A name is looked for anywhere; a path says where, and is taken at its word.
  it("takes a path with a slash for the one note it spells out", () => {
    expect(wikiLinkPath("notes/borges", PATHS)).toBe("notes/borges.md");
  });

  it("still opens the note a path with a slash lands on", () => {
    expect(wikiLinkPath("reading/borges", PATHS)).toBe("reading/borges.md");
  });
});

/** What the editor offers with the caret at the end of `doc`, or at `pos`. */
function complete(doc: string, paths?: string[], pos = doc.length) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, extensions: [WikiLink] }),
      ...(paths ? [vaultPaths.of(paths)] : []),
    ],
  });

  return wikiLinkCompletions(new CompletionContext(state, pos, false));
}

describe("wikiLinkCompletions", () => {
  it("offers every note in the vault once a link is opened", () => {
    const result = complete("see [[", PATHS);

    expect(result?.options.map(({ label }) => label)).toEqual([
      "daily/2026-08-05",
      "index",
      "reading/borges",
    ]);
  });

  it("completes what follows the brackets, not the brackets themselves", () => {
    const result = complete("see [[bor", PATHS);

    // The whole vault, still: CodeMirror filters the list against what has
    // been typed, and it needs the text to filter with.
    expect(result?.from).toBe(6);
    expect(result?.options).toHaveLength(PATHS.length);
  });

  it("closes the link it completes, nothing else having closed it", () => {
    // Typing `[[` leaves the brackets open: markdown's close-brackets does not
    // answer a `[` with a `]`. Completing a name that leaves the link unclosed
    // would be a link only until you looked at it.
    const result = complete("see [[bor", PATHS);

    expect(result?.options.map(({ apply }) => apply)).toEqual([
      "daily/2026-08-05]]",
      "index]]",
      "reading/borges]]",
    ]);
  });

  it("adds no second pair where the link is already closed", () => {
    const result = complete("see [[bor]] and", PATHS, "see [[bor".length);

    expect(result?.options.map(({ apply }) => apply)).toEqual([
      "daily/2026-08-05",
      "index",
      "reading/borges",
    ]);
  });

  it("offers nothing outside a wikilink", () => {
    expect(complete("see borges", PATHS)).toBeNull();
  });

  it("offers nothing once the link is closed", () => {
    expect(complete("see [[borges]] and ", PATHS)).toBeNull();
  });

  it("offers nothing where the vault is not known, as in a preview pane", () => {
    expect(complete("see [[")).toBeNull();
  });
});
