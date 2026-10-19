import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { frontmatter } from "@/lib/frontmatter-language";
import { Highlight } from "@/lib/markdown-highlight";
import { MathSyntax } from "@/lib/math";
import { Tag } from "@/lib/tag";
import { WikiLink } from "@/lib/wikilink";

/**
 * How a note is parsed: markdown under the frontmatter the vault writes.
 *
 * Shared rather than configured twice, because the finder's pane shows the note
 * as opening it will show it, and two copies of this would drift into two
 * renderings of one note.
 *
 * The wrapping is what keeps the block off the page as markdown. Markdown alone
 * reads the opening `---` as a horizontal rule and the closing one as the
 * underline of a heading, so every note would open with its dates drawn as a
 * title. A `---` that nothing closes is no block, though: it is a rule, and
 * the note under it is markdown.
 */
export function noteLanguage(): LanguageSupport {
  return frontmatter(
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [Highlight, MathSyntax, Tag, WikiLink],
    }),
  );
}
