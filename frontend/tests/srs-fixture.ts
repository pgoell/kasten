import { type Card, parseCards } from "@/lib/review/srs";

/** The one card the text holds. A test naming a card and getting none is the failure. */
export function only(text: string, at = 0): Card {
  const card = parseCards(text)[at];
  if (card === undefined) throw new Error(`no card ${at} in ${JSON.stringify(text)}`);
  return card;
}

export const NOTE = `---
id: 019fd770-e40a-72e7-9abc-2cc62eeaeb19
---
# AWS drills

#flashcards/aws

What does S3 stand for?::Simple Storage Service

The three storage classes worth knowing
?
Standard, Infrequent Access, Glacier
`;
