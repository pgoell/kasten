import { fireEvent } from "@testing-library/react";

/**
 * Run an ex command, the way a user types one.
 *
 * `:` opens a panel with its own input and moves focus there, so the rest of
 * the command never reaches `.cm-content`.
 */
export function runExCommand(container: HTMLElement, command: string) {
  fireEvent.keyDown(container.querySelector(".cm-content") as HTMLElement, { key: ":" });

  const input = container.querySelector(".cm-vim-panel input") as HTMLInputElement;
  input.value = command;
  fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
}

/**
 * Delete the line the cursor sits on, and read back what is left.
 *
 * `dd` is how these tests ask where the cursor is without reaching into the
 * view, which they have no handle on.
 */
export function deleteCurrentLine(container: HTMLElement) {
  const content = container.querySelector(".cm-content") as HTMLElement;
  fireEvent.keyDown(content, { key: "d" });
  fireEvent.keyDown(content, { key: "d" });
  return content.textContent;
}

/** A passage a note took out of a book, and the block that carries it. */
export const PASSAGE = "Systems that tolerate faults are called fault-tolerant.";
export const HIGHLIGHT = `> ${PASSAGE}\n\nStorage and Retrieval ^hl-a3f9c1`;
