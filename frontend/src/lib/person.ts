/**
 * What the vault holds about one person, read off the lines that link them. A person is a note
 * with `type: Person`. Only a `[[link]]` counts: a bare name could be another person sharing it,
 * and a guessed match would put their work on this card.
 */

import type { SearchHit } from "@/lib/api";
import { readField } from "@/lib/note-frontmatter";
import { isOpen, parseTodo, type Todo } from "@/lib/todo/todo";
import { wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

/** The frontmatter type a person note carries. The ontology note lists it too. */
export const PERSON = "Person";

/** Whether this note is a person's. The card draws under one and under no other. */
export function isPerson(text: string): boolean {
  return readField(text, "type") === PERSON;
}

/**
 * Whether a line links the person. Targets resolve against the vault listing as the backlinks
 * panel does, so `[[Max Bosch]]` and the full path to the same note both match.
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
 * Every open todo naming them, soonest due first and undated last. Fed `GET /api/todos` hits, so
 * the parse is what tells a todo from a line that only looks like a checkbox.
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

/** A meeting they were in: its note, the date in its name, and the line that named them. */
export interface Meeting {
  path: string;
  date: string;
  line: number;
}

/**
 * The meetings they were in, most recent first, one per note. The date comes from the filename,
 * since `created` and `modified` are file stamps, not the day the meeting was held.
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
 * A done-log line, `- ✅ <date> <words>`, deliberately not a checkbox. `todo-write.ts` says why.
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
