/**
 * What the vault holds about one person, read off the lines that link them.
 *
 * A person is a note like any other, marked `type: Person` in its frontmatter.
 * Nothing else records who they are, so everything here starts from one
 * question: does this line carry a `[[link]]` that resolves to their note. A
 * name in prose does not count. Two colleagues share a first name, a surname is
 * a word, and a card that guessed would put another person's work on this one's
 * page, which is the one failure worth ruling out by construction.
 *
 * The cost is that only lines written with a link are found. The vocabulary is
 * `[[Name]]` in the todo itself, which the done log then carries with it: the
 * log copies the todo's words, so linking a person once makes them show in both
 * halves of the card.
 */

import type { SearchHit } from "@/lib/api";
import { readField } from "@/lib/note-frontmatter";
import { isOpen, parseTodo, type Todo } from "@/lib/todo";
import { wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

/** The frontmatter type a person note carries. The ontology note lists it too. */
export const PERSON = "Person";

/** Whether this note is a person's. The card draws under one and under no other. */
export function isPerson(text: string): boolean {
  return readField(text, "type") === PERSON;
}

/**
 * Whether a line links the person, rather than only mentioning them.
 *
 * Each target is resolved against the vault listing for the reason the
 * backlinks panel resolves its own: `[[Max Bosch]]` and `[[03 Areas/08
 * People/Max Bosch]]` are one note, and a second Max in another folder is not.
 */
function links(text: string, person: string, paths: string[]): boolean {
  return wikiLinkTargets(text).some((target) => wikiLinkPath(target, paths) === person);
}

/** An open todo of theirs, the line it sits on kept so the card can open it. */
export interface PersonTodo {
  hit: SearchHit;
  todo: Todo;
}

/**
 * Every open todo naming them, the soonest due first.
 *
 * Fed the answer to `GET /api/todos`, which matches the shape of a checkbox and
 * nothing else, so the parse is what tells a todo from a line that looks like
 * one. Undated todos come last rather than first: a list sorted by when work is
 * due has nowhere else to put the work that is due whenever.
 */
export function personTodos(hits: SearchHit[], person: string, paths: string[]): PersonTodo[] {
  const found: PersonTodo[] = [];

  for (const hit of hits) {
    if (!links(hit.text, person, paths)) continue;
    const todo = parseTodo(hit.text);
    if (todo === null || !isOpen(todo)) continue;
    found.push({ hit, todo });
  }

  return found.sort((one, other) => (one.todo.due ?? "￿").localeCompare(other.todo.due ?? "￿"));
}

/** The date a meeting note's filename opens with, which is the day it happened. */
const MEETING = /^(\d{4}-\d{2}-\d{2}) /;

/** One meeting they were in: the note, the day its name says it happened, and
 * the line that named them, which is where opening it lands. */
export interface Meeting {
  path: string;
  date: string;
  line: number;
}

/**
 * The meetings they were in, most recent first.
 *
 * A meeting is a note whose filename opens with a date, which is the convention
 * every meeting note in the vault already follows and the only thing that dates
 * one: `created` and `modified` are file stamps, and a meeting written up two
 * days later carries the day it was written, not the day it was held.
 *
 * One note counts once however many times it links the person, the attendee
 * line and the summary naming them both.
 */
export function meetings(
  hits: SearchHit[],
  person: string,
  paths: string[],
  most: number,
): Meeting[] {
  const found = new Map<string, Meeting>();

  for (const hit of hits) {
    if (found.has(hit.path) || !links(hit.text, person, paths)) continue;
    const date = MEETING.exec(hit.path.slice(hit.path.lastIndexOf("/") + 1))?.[1];
    if (date !== undefined) found.set(hit.path, { path: hit.path, date, line: hit.line });
  }

  return [...found.values()]
    .sort((one, other) => other.date.localeCompare(one.date))
    .slice(0, most);
}

/**
 * A line of the done log, which is `- ✅ <date> <words>` and deliberately not a
 * checkbox. `todo-write.ts` writes it and says why it is spelled this way.
 */
const LOGGED = /^[ \t]*- ✅[ \t]+(\d{4}-\d{2}-\d{2})[ \t]+(.*)$/;

/** One finished thing that named them: when it was done, and what it was. */
export interface Done {
  hit: SearchHit;
  date: string;
  text: string;
}

/** What was finished that named them, most recently finished first. */
export function personDone(
  hits: SearchHit[],
  person: string,
  paths: string[],
  most: number,
): Done[] {
  const found: Done[] = [];

  for (const hit of hits) {
    const logged = LOGGED.exec(hit.text);
    if (logged === null || !links(hit.text, person, paths)) continue;
    found.push({ hit, date: logged[1] ?? "", text: logged[2] ?? "" });
  }

  return found.sort((one, other) => other.date.localeCompare(one.date)).slice(0, most);
}
