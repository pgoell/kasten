import type { SyntaxNode } from "@lezer/common";
import { GFM, parser } from "@lezer/markdown";
import { memo, type ReactNode } from "react";

const chat = parser.configure(GFM);

/** Syntax drawn by the element around it, so never shown as text. */
const MARKS = new Set([
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "LinkMark",
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "LinkTitle",
  "LinkLabel",
  "StrikethroughMark",
  "TaskMarker",
  "TableDelimiter",
]);

const HEADING: Record<string, string> = {
  1: "text-k-19 font-semibold",
  2: "text-k-15 font-semibold",
  3: "text-k-15 font-semibold",
};

const CODE = "rounded bg-k-inset px-1 py-px font-mono text-[0.88em]";

/** Only addresses that leave for a page: no `javascript:` from a model's text. */
function safeHref(href: string): string | undefined {
  return /^(https?:|mailto:)/i.test(href) ? href : undefined;
}

function Anchor({ href, children }: { href: string; children: ReactNode }) {
  const safe = safeHref(href);
  if (safe === undefined) return <>{children}</>;
  return (
    <a href={safe} target="_blank" rel="noreferrer" className="text-k-link underline">
      {children}
    </a>
  );
}

function childrenOf(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) out.push(child);
  return out;
}

/** The text between `from` and `to`, with the nodes inside drawn. */
function inline(node: SyntaxNode, src: string, from = node.from, to = node.to): ReactNode[] {
  const out: ReactNode[] = [];
  let at = from;
  for (const child of childrenOf(node)) {
    if (child.to <= from || child.from >= to) continue;
    // A paragraph inside a quote or list carries the indent on each line.
    if (child.from > at) out.push(src.slice(at, child.from).replace(/\n[ \t>]*/g, "\n"));
    if (!MARKS.has(child.name)) out.push(span(child, src, out.length));
    at = child.to;
  }
  if (at < to) out.push(src.slice(at, to).replace(/\n[ \t>]*/g, "\n"));
  return out;
}

function span(node: SyntaxNode, src: string, key: number): ReactNode {
  switch (node.name) {
    case "Emphasis":
      return <em key={key}>{inline(node, src)}</em>;
    case "StrongEmphasis":
      return <strong key={key}>{inline(node, src)}</strong>;
    case "Strikethrough":
      return <s key={key}>{inline(node, src)}</s>;
    case "InlineCode":
      return (
        <code key={key} className={CODE}>
          {inline(node, src)}
        </code>
      );
    case "HardBreak":
      return <br key={key} />;
    case "Escape":
      return src.slice(node.from + 1, node.to);
    case "URL":
    case "Autolink": {
      const href = src.slice(node.from, node.to).replace(/^<|>$/g, "");
      return (
        <Anchor key={key} href={href}>
          {href}
        </Anchor>
      );
    }
    case "Link":
    case "Image": {
      const marks = childrenOf(node).filter((child) => child.name === "LinkMark");
      const url = node.getChild("URL");
      const label = inline(node, src, marks[0]?.to ?? node.from, marks[1]?.from ?? node.to);
      if (url === null) return <span key={key}>{label}</span>;
      return (
        <Anchor key={key} href={src.slice(url.from, url.to)}>
          {label}
        </Anchor>
      );
    }
    default:
      return src.slice(node.from, node.to);
  }
}

function block(node: SyntaxNode, src: string, key: number): ReactNode {
  const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
  if (heading) {
    return (
      <p key={key} className={HEADING[heading[1] ?? ""] ?? "font-semibold"}>
        {trimmed(inline(node, src))}
      </p>
    );
  }
  switch (node.name) {
    case "Paragraph":
      return <p key={key}>{inline(node, src)}</p>;
    case "Blockquote":
      return (
        <blockquote key={key} className="space-y-2 border-k-rule border-l-2 pl-3 text-k-ink-soft">
          {blocks(node, src)}
        </blockquote>
      );
    case "BulletList":
      return (
        <ul key={key} className="list-disc space-y-1 pl-5 marker:text-k-muted">
          {blocks(node, src)}
        </ul>
      );
    case "OrderedList":
      return (
        <ol key={key} className="list-decimal space-y-1 pl-5 marker:text-k-muted">
          {blocks(node, src)}
        </ol>
      );
    case "ListItem":
      return (
        <li key={key} className="space-y-1">
          {blocks(node, src)}
        </li>
      );
    case "Task": {
      const marker = node.getChild("TaskMarker");
      const done = marker !== null && /x/i.test(src.slice(marker.from, marker.to));
      return (
        <p key={key} className={done ? "text-k-muted line-through" : ""}>
          <span aria-hidden="true">{done ? "☑ " : "☐ "}</span>
          {trimmed(inline(node, src))}
        </p>
      );
    }
    case "FencedCode":
    case "CodeBlock": {
      const code = node.getChildren("CodeText").map((part) => src.slice(part.from, part.to));
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md bg-k-inset px-3 py-2 font-mono text-[12.5px] leading-relaxed"
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
    }
    case "HorizontalRule":
      return <hr key={key} className="border-k-rule" />;
    case "Table":
      return <Table key={key} node={node} src={src} />;
    default:
      return (
        <p key={key} className="whitespace-pre-wrap">
          {src.slice(node.from, node.to)}
        </p>
      );
  }
}

function trimmed(parts: ReactNode[]): ReactNode[] {
  if (typeof parts[0] === "string") parts[0] = parts[0].trimStart();
  return parts;
}

function blocks(node: SyntaxNode, src: string): ReactNode[] {
  return childrenOf(node)
    .filter((child) => !MARKS.has(child.name))
    .map((child, at) => block(child, src, at));
}

function Table({ node, src }: { node: SyntaxNode; src: string }) {
  const rows = childrenOf(node).filter(
    (row) => row.name === "TableHeader" || row.name === "TableRow",
  );
  const cells = (row: SyntaxNode) => row.getChildren("TableCell");
  const [head, ...body] = rows;
  return (
    <div className="overflow-x-auto">
      <table className="text-[0.93em]">
        {head !== undefined && (
          <thead>
            <tr>
              {cells(head).map((cell, at) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells keep their column.
                <th key={at} className="border-k-rule border-b px-2 py-1 text-left font-semibold">
                  {trimmed(inline(cell, src))}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, at) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows keep their place.
            <tr key={at}>
              {cells(row).map((cell, column) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells keep their column.
                <td key={column} className="border-k-rule border-b px-2 py-1 align-top">
                  {trimmed(inline(cell, src))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Claude's markdown as elements. React escapes the text, so raw HTML in it shows as text. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const tree = chat.parse(text);
  return <div className="space-y-3 break-words">{blocks(tree.topNode, text)}</div>;
});
