import { screen, waitFor } from "@testing-library/react";

/**
 * The card on screen, once the words are in it.
 *
 * `findByTestId` answers the moment the element reaches the DOM, and the words
 * arrive one effect later: the front of a card is drawn by `NotePreview`, which
 * builds a CodeMirror view in an effect and appends it to the div. Waiting on
 * the element alone left every assertion after it racing that effect, and on a
 * loaded machine the assertion won a few times a hundred runs and read an empty
 * card. Both files that show a card wait through here instead.
 *
 * On the view itself and not on any text in the card: the source line under an
 * answer (#790) is plain React text, there before the view, and a wait on text
 * alone then read a card whose question had not mounted yet.
 */
export function shownCard(): Promise<HTMLElement> {
  return waitFor(() => {
    const card = screen.getByTestId("review-card");
    expect(card.querySelector('[data-testid="review-question"] .cm-content')).not.toBeNull();
    return card;
  });
}
