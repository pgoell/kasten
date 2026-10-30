import { yamlLanguage } from "@codemirror/lang-yaml";
import {
  defineLanguageFacet,
  Language,
  LanguageSupport,
  languageDataProp,
} from "@codemirror/language";
import {
  type Input,
  NodeType,
  Parser,
  type ParseWrapper,
  type PartialParse,
  parseMixed,
  Tree,
  type TreeFragment,
} from "@lezer/common";
import { styleTags, tags } from "@lezer/highlight";

const data = defineLanguageFacet();

// The node names are yamlFrontmatter's, so its DashLine styling keeps matching them.
const Document = NodeType.define({
  id: 0,
  name: "Document",
  top: true,
  props: [[languageDataProp, data]],
});
const Frontmatter = NodeType.define({ id: 1, name: "Frontmatter" });
const DashLine = NodeType.define({
  id: 2,
  name: "DashLine",
  props: [styleTags({ DashLine: tags.meta })],
});
const FrontmatterContent = NodeType.define({ id: 3, name: "FrontmatterContent" });
const Body = NodeType.define({ id: 4, name: "Body" });

/** Line 1 of a note that opens a block: three dashes, then nothing but blanks. */
const OPEN = /^---[ \t]*\r?$/;

/** How much of the note one read takes while looking for a line's end. */
const CHUNK = 256;

/** Where the line starting at `from` ends: its `\n`, or the end of the note. */
function lineEnd(input: Input, from: number): number {
  for (let pos = from; pos < input.length; pos += CHUNK) {
    const at = input.read(pos, Math.min(input.length, pos + CHUNK)).indexOf("\n");
    if (at >= 0) return pos + at;
  }
  return input.length;
}

/**
 * Where the block ends: the end of its opening line, and the start and end of its closer, or null
 * when there is no block. Read a line at a time, since this runs on every keystroke. A closer
 * starting past `reach` reads as no block, so an unclosed `---` costs only the parsed stretch.
 */
function block(input: Input, reach: number): { open: number; from: number; to: number } | null {
  const length = input.length;
  const end = lineEnd(input, 0);
  if (end === length || !OPEN.test(input.read(0, end))) return null;
  for (let from = end + 1; from < reach; ) {
    const to = lineEnd(input, from);
    if (input.read(from, to).trim() === "---") {
      return { open: end + 1, from, to: Math.min(to + 1, length) };
    }
    from = to + 1;
  }
  return null;
}

/**
 * Where the body starts: past the closer, or 0 with no block. The editor and the highlighting
 * both ask here, so they draw the same line.
 */
export function belowFrontmatter(doc: string): number {
  const input: Input = {
    length: doc.length,
    lineChunks: false,
    chunk: (from) => doc.slice(from),
    read: (from, to) => doc.slice(from, to),
  };
  return block(input, doc.length)?.to ?? 0;
}

/** The note's outer tree up to `reach`: a block and the body under it, or only a body. */
function outline(input: Input, reach: number): Tree {
  // Most notes start with some other text, and need no read past it.
  const found = input.read(0, Math.min(input.length, 3)) === "---" ? block(input, reach) : null;
  if (found === null) return new Tree(Document, [new Tree(Body, [], [], reach)], [0], reach);

  const { open, from, to } = found;
  const length = Math.max(reach, to);
  const front = new Tree(
    Frontmatter,
    [
      new Tree(DashLine, [], [], open),
      new Tree(FrontmatterContent, [], [], from - open),
      new Tree(DashLine, [], [], to - from),
    ],
    [0, open, from],
    to,
  );
  return new Tree(Document, [front, new Tree(Body, [], [], length - to)], [0, to], length);
}

/**
 * Decides block or no block over the whole note on every parse, since a closer typed lower down
 * changes what line 1 is. yamlFrontmatter reads an unpaired `---` as a block to the end, so it is
 * not used. Built on the first advance, not here, so a `stopAt` sent first bounds the read.
 */
class Outline implements PartialParse {
  parsedPos = 0;
  stoppedAt: number | null = null;
  private readonly input: Input;

  constructor(input: Input) {
    this.input = input;
  }

  advance(): Tree {
    const tree = outline(this.input, Math.min(this.input.length, this.stoppedAt ?? Infinity));
    this.parsedPos = tree.length;
    return tree;
  }

  stopAt(pos: number): void {
    this.stoppedAt = pos;
  }
}

class NoteParser extends Parser {
  private readonly wrap: ParseWrapper;

  constructor(content: Parser) {
    super();
    this.wrap = parseMixed((node) =>
      node.type === FrontmatterContent
        ? { parser: yamlLanguage.parser }
        : node.type === Body
          ? { parser: content }
          : null,
    );
  }

  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[],
  ): PartialParse {
    return this.wrap(new Outline(input), input, fragments, ranges);
  }
}

/**
 * The YAML frontmatter block at the top of `content`, read as Obsidian and `frontmatter.py` read
 * it: line 1 is `---` with only blanks after, and the next `---` line closes it.
 * No closer, no block.
 */
export function frontmatter(content: LanguageSupport): LanguageSupport {
  return new LanguageSupport(
    new Language(data, new NoteParser(content.language.parser), [], "yaml-frontmatter"),
    content.support,
  );
}
