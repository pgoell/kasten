/**
 * The `@` press that hands a todo to the agent worker, by its `#agent` tag.
 *
 * Pure over the lines of a note, as `todo-write.ts` is: the line it writes
 * comes back, or the sentence the foot shows when it writes nothing.
 */

import { parseTodo, todoTagsOn, wordsEnd } from "@/lib/todo";
import { descendants, inherited, isClient, type Placed, treeOf } from "@/lib/todo-view";
import { pressedLine } from "@/lib/todo-write";

/** The tag the agent worker picks a todo up by. */
export const AGENT = "#agent";

/**
 * Whether the todo on `line` is client work, by its own tag or a todo above it.
 * The pane's reading, `inherited`, so the two places `@` is pressed agree: only
 * a todo passes client down, and prose between is read through.
 */
function clientAt(lines: string[], line: number): boolean {
  const placed: Placed[] = [];
  for (const [index, text] of lines.entries()) {
    const todo = parseTodo(text);
    if (todo !== null) placed.push({ line: index + 1, todo });
  }
  const node = inherited(treeOf(placed))
    .flatMap((root) => [root, ...descendants(root)])
    .find((found) => found.line === line);
  return node !== undefined && isClient(node.todo);
}

/**
 * Where `line` carries `#agent` as a tag of its own, as offsets. The parser's
 * own reading, so `#agents` and `#agent/x` are other tags, and one in a code
 * span, a link, `https://a.io/p#agent` or a field's value is text.
 */
function agentTags(line: string): number[] {
  return todoTagsOn(line)
    .filter((found) => found.tag === AGENT)
    .map((found) => found.at);
}

/**
 * What `@` makes of line `at` (counting from one) of `lines`: the line to write,
 * or the sentence for the foot when it writes nothing.
 *
 * Only the tag moves. Written in at the end of the words rather than through
 * `patchLine`, whose rebuild would put the tag after any words typed past the
 * fields; taken out with the one space before it. A plain line becomes an open
 * todo first, the way the state keys make one.
 */
export function agentPress(
  lines: string[],
  at: number,
  today: string,
  id: string,
): { line: string } | { why: string } {
  const before = lines[at - 1] ?? "";
  if (before.trim() === "") return { why: "there is no todo on that line" };

  const plain = parseTodo(before) === null;
  const line = plain ? (pressedLine(before, today, id, "open") ?? before) : before;
  const todo = parseTodo(line);
  if (todo === null) return { why: "there is no todo on that line" };

  // The worker leaves client work alone, so handing it over would only park it.
  const read = [...lines];
  read[at - 1] = line;
  if (clientAt(read, at)) return { why: "the agent skips client work" };

  const tags = agentTags(line);
  if (tags.length === 0) {
    // A space before and none after, so taking it back out with the space
    // before gives the line back byte for byte.
    const end = wordsEnd(line);
    return { line: `${line.slice(0, end)} ${AGENT}${line.slice(end)}` };
  }
  // A plain line already naming the agent only needed its box.
  if (plain) return { line };
  // Taken back only while nobody has started on it: past open, the worker may
  // already hold it, and pulling the tag would not stop it.
  if (todo.state !== "open") return { why: "that todo is already with the agent" };

  // Each with the space before it where there is one, which is the space the
  // press above wrote; `fix,#agent` has none to give. Last first, so the
  // earlier offsets still hold.
  let out = line;
  for (const at of tags.reverse()) {
    const from = /[ \t]/.test(out[at - 1] ?? "") ? at - 1 : at;
    out = out.slice(0, from) + out.slice(at + AGENT.length);
  }
  // `fix,#agent#kasten` would leave `#kasten` after the comma, a tag it was
  // not, so a take-back that changes any other tag writes nothing.
  const others = todo.tags.filter((tag) => tag !== AGENT).join(" ");
  if (parseTodo(out)?.tags.join(" ") !== others) {
    return { why: "taking #agent out would make a tag of what follows it" };
  }
  return { line: out };
}
