import {
  CLOZE_SR,
  clozeComment,
  parks,
  SR,
  SUSPEND_TOKEN,
  withoutHeadToken,
  withoutToken,
} from "@/lib/review/card-line";
import type { Card, Schedule } from "@/lib/review/srs";

/** `next` written as the comment that goes in the note, named by its number on a cloze. */
function comment(next: Schedule, cloze: number | null = null): string {
  return `<!--SR:${cloze === null ? "" : `c${cloze}`}!${next.due},${next.interval},${next.ease}-->`;
}

/**
 * `text` with this card's schedule set, every other line byte-identical.
 *
 * A line splice rather than a rebuild of the note, because the note is the
 * user's and a rating is not licence to reflow it.
 */
export function writeSchedule(text: string, card: Card, next: Schedule): string {
  const lines = text.split("\n");
  const last = lines[card.to] ?? "";

  // A cloze rewrites its own number's comment and no other. Where it has none
  // yet it joins the line the others sit on, which is the cloze's own line, or
  // the line under a `?` back once any comment or the token has made one.
  if (card.cloze !== null) {
    const own = clozeComment(card.cloze);
    const written = comment(next, card.cloze);
    if (own.test(last)) lines[card.to] = last.replace(own, written);
    else if (card.inline || CLOZE_SR.test(last) || SR.test(last) || parks(last)) {
      lines[card.to] = `${last.trimEnd()} ${written}`;
    } else lines.splice(card.to + 1, 0, written);
    return lines.join("\n");
  }

  if (card.inline) {
    lines[card.to] = SR.test(last)
      ? last.replace(SR, comment(next))
      : `${last.trimEnd()} ${comment(next)}`;
  } else if (SR.test(last)) {
    lines[card.to] = last.replace(SR, comment(next));
  } else {
    lines.splice(card.to + 1, 0, comment(next));
  }

  return lines.join("\n");
}

/** A schedule comment of either kind, plain or a cloze number's, whichever comes first. */
const ANY_SR = new RegExp(`${SR.source}|${CLOZE_SR.source}`);

/**
 * `text` with this card parked or put back, every other line byte-identical.
 * The token and the schedule are separate, so putting a card back keeps its date.
 */
export function setSuspended(text: string, card: Card, on: boolean): string {
  const lines = text.split("\n");
  const last = lines[card.to] ?? "";
  // A cloze parks every number off the one token, before the first of its
  // comments, so parking any number writes the same line as parking another.
  // Either kind of comment: a `?` card written before cloze existed whose front
  // happens to hold a mark is a cloze now, its schedule line holding a plain one.
  const schedule = card.cloze === null ? SR : ANY_SR;

  if (card.inline) {
    lines[card.to] = on
      ? schedule.test(last)
        ? last.replace(schedule, `${SUSPEND_TOKEN} $&`)
        : `${last.trimEnd()} ${SUSPEND_TOKEN}`
      : withoutToken(last);
    return lines.join("\n");
  }

  if (!on) {
    const bare = withoutHeadToken(last);
    // A line the token was the whole of goes with it, so the note is left as
    // it was rather than gaining a blank line per parking.
    if (bare.trim() === "") lines.splice(card.to, 1);
    else lines[card.to] = bare;
    return lines.join("\n");
  }

  // `card.to` is the schedule's line where the card has one, and the last line
  // of its back where it has none.
  if (schedule.test(last)) lines[card.to] = `${SUSPEND_TOKEN} ${last}`;
  else lines.splice(card.to + 1, 0, SUSPEND_TOKEN);
  return lines.join("\n");
}

/**
 * `text` with `question` appended as a card waiting for its answer. Appending, not
 * inserting, keeps the ordinals a running sitting holds. A deck tag at the head needs nothing here.
 */
export function appendStub(text: string, question: string): string {
  return `${text.replace(/\n*$/, "")}\n\n${question}::\n`;
}
