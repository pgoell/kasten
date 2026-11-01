/**
 * The `@` press that hands a todo to the agent worker, by its `#agent` tag. Pure, as
 * `todo-write.ts` is: it returns the line, or the foot's sentence when nothing is written.
 */

import { bodyFences } from "@/lib/note-section";
import { parseTodo, todoTagsOn, wordsEnd } from "@/lib/todo/todo";
import { descendants, inherited, isClient, noteTree } from "@/lib/todo/todo-view";
import { pressedLine } from "@/lib/todo/todo-write";

/** The tag the agent worker picks a todo up by. */
export const AGENT = "#agent";

/**
 * Whether the todo on `line` is client work, by its own tag or a todo above it.
 * Read off the tree the writes tick (#1445), so a todo past a heading takes nothing from above it.
 */
function clientAt(lines: string[], line: number): boolean {
  const node = inherited(noteTree(lines))
    .flatMap((root) => [root, ...descendants(root)])
    .find((found) => found.line === line);
  return node !== undefined && isClient(node.todo);
}

/**
 * Offsets of `#agent` as a tag of its own, read by the parser so `#agents` and
 * `#agent/x` do not count. Code, links and field values are text.
 */
function agentTags(line: string): number[] {
  return todoTagsOn(line)
    .filter((found) => found.tag === AGENT)
    .map((found) => found.at);
}

/**
 * Only the tag moves. It goes in at the end of the words, not through `patchLine`,
 * which would put it after any words typed past the fields.
 */
export function agentPress(
  lines: string[],
  at: number,
  today: string,
  id: string,
): { line: string } | { why: string } {
  const before = lines[at - 1] ?? "";
  if (before.trim() === "") return { why: "there is no todo on that line" };

  // The worker reads `GET /api/todos`, which sends no fenced line, so a tag there would only sit.
  if (bodyFences(lines).coded.has(at - 1)) return { why: "that line is code" };

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
