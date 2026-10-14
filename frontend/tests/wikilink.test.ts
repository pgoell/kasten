import { readFileSync } from "node:fs";
import path from "node:path";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
  FILE_SUFFIXES,
  outgoingLinks,
  plainLinks,
  resolveIn,
  splitTarget,
  vaultPaths,
  WikiLink,
  wikiLinkCompletions,
  wikiLinkLands,
  wikiLinkPath,
  wikiLinkTargets,
} from "@/lib/wikilink";

const PATHS = ["daily/2026-08-05.md", "index.md", "reading/borges.md"];

describe("wikiLinkTargets", () => {
  it("reads every link on the line, in the order they were written", () => {
    expect(wikiLinkTargets("see [[borges]] and [[index]]")).toEqual(["borges", "index"]);
  });

  it("finds nothing in a line holding no link", () => {
    expect(wikiLinkTargets("borges wrote the library")).toEqual([]);
  });

  // The three the parser refuses, so the reader has to refuse them too:
  // a link names one note, on one line, and it names something.
  it("refuses a link that never closed", () => {
    expect(wikiLinkTargets("see [[borges")).toEqual([]);
  });

  it("refuses a pair of empty brackets", () => {
    expect(wikiLinkTargets("[[]] and [[   ]]")).toEqual([]);
  });

  it("refuses a bracket inside the name", () => {
    expect(wikiLinkTargets("[[bor[ges]]")).toEqual([]);
  });
});

describe("outgoingLinks", () => {
  it("names the note behind every link, whichever way it was written", () => {
    expect(outgoingLinks("see [[borges]] and [[daily/2026-08-05]]", PATHS)).toEqual([
      "reading/borges.md",
      "daily/2026-08-05.md",
    ]);
  });

  it("reads the links off every line of the note", () => {
    expect(outgoingLinks("# title\n\nsee [[index]]\n\nand [[borges]]\n", PATHS)).toEqual([
      "index.md",
      "reading/borges.md",
    ]);
  });

  it("names a note twice linked only once", () => {
    expect(outgoingLinks("[[borges]] and [[reading/borges]]", PATHS)).toEqual([
      "reading/borges.md",
    ]);
  });

  it("leaves out a link to a note nobody has written yet", () => {
    // The panel is a list of notes, and there is no note there to list.
    expect(outgoingLinks("see [[cortazar]]", PATHS)).toEqual([]);
  });

  it("counts a link with an alias or a heading, embedded or not, as one to the note", () => {
    const text = "[[borges|x]] [[index#H]] ![[daily/2026-08-05#H]] ![[borges|y]]";
    expect(outgoingLinks(text, PATHS)).toEqual([
      "reading/borges.md",
      "index.md",
      "daily/2026-08-05.md",
    ]);
  });

  it("counts no link to a heading of the note itself", () => {
    expect(outgoingLinks("see [[#The Aleph]]", PATHS)).toEqual([]);
  });
});

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
    // A bare name says nothing about where the note belongs, and the inbox is
    // where a note with nowhere to be goes.
    expect(wikiLinkPath("borges the elder", PATHS)).toBe("00 Inbox/borges the elder.md");
  });

  it("still finds a note the inbox already holds by its bare name", () => {
    expect(wikiLinkPath("cortazar", ["00 Inbox/cortazar.md"])).toBe("00 Inbox/cortazar.md");
  });

  it("leaves a path with a slash out of the inbox, wherever it points", () => {
    expect(wikiLinkPath("notes/borges", PATHS)).toBe("notes/borges.md");
  });

  // A name is looked for anywhere; a path says where, and is taken at its word.
  it("takes a path with a slash for the one note it spells out", () => {
    expect(wikiLinkPath("notes/borges", PATHS)).toBe("notes/borges.md");
  });

  it("still opens the note a path with a slash lands on", () => {
    expect(wikiLinkPath("reading/borges", PATHS)).toBe("reading/borges.md");
  });

  it("takes a page of HTML by its full file name, wherever it sits", () => {
    const paths = [...PATHS, "news/2026-10-07.html"];
    expect(wikiLinkPath("2026-10-07.html", paths)).toBe("news/2026-10-07.html");
    expect(wikiLinkPath("news/2026-10-07.html", paths)).toBe("news/2026-10-07.html");
  });

  it("keeps a note and the page of the same name apart", () => {
    const paths = ["report.md", "report.html"];
    expect(wikiLinkPath("report", paths)).toBe("report.md");
    expect(wikiLinkPath("report.html", paths)).toBe("report.html");
  });

  it("names the note an alias or a heading is written on", () => {
    expect(wikiLinkPath("borges|the man", PATHS)).toBe("reading/borges.md");
    expect(wikiLinkPath("borges#The Aleph", PATHS)).toBe("reading/borges.md");
    expect(wikiLinkPath("borges#The Aleph|the story", PATHS)).toBe("reading/borges.md");
  });

  it("makes a missing note under its name alone, not under its alias", () => {
    expect(wikiLinkPath("cortazar|Julio", PATHS)).toBe("00 Inbox/cortazar.md");
    expect(wikiLinkPath("cortazar#Rayuela", PATHS)).toBe("00 Inbox/cortazar.md");
  });

  it("takes a page of HTML behind an alias", () => {
    const paths = ["report.md", "report.html"];
    expect(wikiLinkPath("report.html|the report", paths)).toBe("report.html");
  });

  it("names no note at all for a heading of the note it is written in", () => {
    // `.md` alone, or the inbox folder, is a path a create would act on.
    expect(wikiLinkPath("#The Aleph", PATHS)).toBe("");
  });

  it("takes every file suffix as a file, ignoring case, and a dotted folder as a note", () => {
    for (const suffix of FILE_SUFFIXES) {
      expect(wikiLinkPath(`x/plan${suffix}`, [])).toBe(`x/plan${suffix}`);
      expect(wikiLinkPath(`plan${suffix.toUpperCase()}`, [`a/plan${suffix}`])).toBe(
        `a/plan${suffix}`,
      );
    }
    expect(wikiLinkPath("plan.pdf", [])).toBe("00 Inbox/plan.pdf");
    expect(wikiLinkPath("Report.HTML", ["pages/report.html"])).toBe("pages/report.html");
    expect(wikiLinkPath("a.b/note", [])).toBe("a.b/note.md");
  });

  it("answers what the backend's link_path answers for the shared cases", () => {
    // The table the backend's tests read too, so the two rules cannot drift.
    const table = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "../../backend/tests/link_paths.json"), "utf8"),
    ) as { suffixes: string[]; paths: string[]; cases: { target: string; path: string }[] };

    expect(new Set(FILE_SUFFIXES)).toEqual(new Set(table.suffixes));
    for (const { target, path: answer } of table.cases) {
      expect(wikiLinkPath(target, table.paths), target).toBe(answer);
    }
  });
});

describe("wikiLinkLands", () => {
  it("lands a link with an alias or a heading on the note it names", () => {
    expect(wikiLinkLands("borges|the man", PATHS)).toBe(true);
    expect(wikiLinkLands("borges#The Aleph|the story", PATHS)).toBe(true);
    expect(wikiLinkLands("cortazar|Julio", PATHS)).toBe(false);
  });

  it("lands a heading of the note it is written in", () => {
    expect(wikiLinkLands("#The Aleph", PATHS)).toBe(true);
  });

  it("lands a link to an asset the vault holds, and only then", () => {
    const assets = ["00 Inbox/plan.pdf", "docs/Book.epub"];
    expect(wikiLinkLands("plan.pdf", [...PATHS, ...assets])).toBe(true);
    expect(wikiLinkLands("Plan.PDF|the plan", [...PATHS, ...assets])).toBe(true);
    expect(wikiLinkLands("book.epub", [...PATHS, ...assets])).toBe(true);
    expect(wikiLinkLands("plan.pdf", PATHS)).toBe(false);
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
  it("offers a page of HTML with its suffix on", () => {
    const result = complete("see [[", ["index.md", "news/2026-10-07.html"]);

    expect(result?.options.map(({ label }) => label)).toEqual(["index", "news/2026-10-07.html"]);
  });

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

  // What the document reads once `reading/borges` is accepted with the caret
  // at `pos`: the completion's span swapped for the option's apply.
  function accept(doc: string, pos: number) {
    const result = complete(doc, PATHS, pos);
    const option = result?.options.find(({ label }) => label === "reading/borges");
    return doc.slice(0, result?.from) + option?.apply + doc.slice(result?.to ?? pos);
  }

  it("keeps the alias when the name before it is completed", () => {
    expect(accept("[[bor|Jo]]", "[[bor".length)).toBe("[[reading/borges|Jo]]");
  });

  it("keeps the heading when the name before it is completed", () => {
    expect(accept("[[bor#Head]]", "[[bor".length)).toBe("[[reading/borges#Head]]");
  });

  it("keeps a table's escaped bar when the name before it is completed", () => {
    expect(accept("| [[bor\\|Jo]] |", "| [[bor".length)).toBe("| [[reading/borges\\|Jo]] |");
  });

  it("closes the link when the bar after it ends a table cell", () => {
    expect(accept("|[[bor|", "|[[bor".length)).toBe("|[[reading/borges]]|");
  });

  it.each([
    ["an alias", "[[borges|Jo"],
    ["a heading", "[[borges#He"],
    ["a table's alias", "[[borges\\|Jo"],
  ])("offers no note once the caret is in %s", (_, doc) => {
    expect(complete(doc, PATHS)).toBeNull();
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

describe("splitTarget", () => {
  it("reads a bare name as the name alone", () => {
    expect(splitTarget(" borges ")).toEqual({ name: "borges", heading: null, alias: null });
  });

  it("takes the heading off at the first hash", () => {
    expect(splitTarget("borges # The Aleph #2")).toEqual({
      name: "borges",
      heading: "The Aleph #2",
      alias: null,
    });
  });

  it("takes the alias off at the first bar, before the heading", () => {
    expect(splitTarget("borges|the man")).toEqual({
      name: "borges",
      heading: null,
      alias: "the man",
    });
    expect(splitTarget("borges#Aleph|see #this|too")).toEqual({
      name: "borges",
      heading: "Aleph",
      alias: "see #this|too",
    });
  });

  it("reads a bar escaped for a table cell as the bar", () => {
    expect(splitTarget("borges#Life\\|Jorge")).toEqual({
      name: "borges",
      heading: "Life",
      alias: "Jorge",
    });
  });

  it("calls an empty heading none", () => {
    expect(splitTarget("borges#  ").heading).toBeNull();
  });
});

describe("resolveIn", () => {
  const IMAGES = ["99 Misc/images/Shot.png", "photos/cat.png"];

  it("finds a file by its name wherever it sits, ignoring case", () => {
    expect(resolveIn("shot.png", IMAGES)).toBe("99 Misc/images/Shot.png");
  });

  it("takes a path with a slash at its word", () => {
    expect(resolveIn("photos/cat.png", IMAGES)).toBe("photos/cat.png");
    expect(resolveIn("photos/dog.png", IMAGES)).toBe("photos/dog.png");
  });

  it("answers null for a bare name nothing holds", () => {
    expect(resolveIn("dog.png", IMAGES)).toBeNull();
  });
});

describe("plainLinks", () => {
  it("writes a link as its name, brackets and folders gone", () => {
    expect(plainLinks("paired with [[Max Bosch]] on the script")).toBe(
      "paired with Max Bosch on the script",
    );
    expect(plainLinks("see [[02 Projects/2026-09-28 Kickoff]]")).toBe("see 2026-09-28 Kickoff");
  });

  it("writes a link with an alias as the alias", () => {
    expect(plainLinks("paired with [[03 Areas/Max Bosch|Max]] today")).toBe(
      "paired with Max today",
    );
    expect(plainLinks("see [[02 Projects/Kickoff#Agenda|the agenda]]")).toBe("see the agenda");
  });

  it("writes a link to a heading as the name and the heading, folders gone", () => {
    expect(plainLinks("see [[02 Projects/Kickoff#Agenda]]")).toBe("see Kickoff#Agenda");
    expect(plainLinks("see [[#Agenda]]")).toBe("see #Agenda");
  });

  it("leaves a line holding no link exactly as it was", () => {
    expect(plainLinks("ask Max for the script [not a link]")).toBe(
      "ask Max for the script [not a link]",
    );
  });
});
