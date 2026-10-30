import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { frontmatter } from "@/lib/frontmatter-language";
import { Highlight } from "@/lib/markdown-highlight";
import { MathSyntax } from "@/lib/math";
import { Tag } from "@/lib/tag";
import { WikiLink } from "@/lib/wikilink";

/**
 * Markdown under the vault's frontmatter. Shared with the finder's preview, so both parse alike.
 * Without the wrapper, markdown reads the `---` fences as a rule and a heading underline.
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
