import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { keyboardUnasked } from "@/lib/last-input";
import { NARROW, stubMatchMedia } from "./match-media";

/** A press as the browser reports it, jsdom's own pointer event carrying no type. */
function press(pointerType: string) {
  const event = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  document.body.dispatchEvent(event);
}

// A key is the last word, so no test leaves a touch behind for the next file.
afterEach(() => {
  fireEvent.keyDown(document.body, { key: "a" });
  vi.unstubAllGlobals();
});

describe("keyboardUnasked", () => {
  it("says yes after a finger on a phone, and no after a key or a mouse", () => {
    stubMatchMedia({ [NARROW]: true });

    press("touch");
    expect(keyboardUnasked()).toBe(true);

    fireEvent.keyDown(document.body, { key: "a" });
    expect(keyboardUnasked()).toBe(false);

    press("touch");
    press("mouse");
    expect(keyboardUnasked()).toBe(false);
  });

  it("says no in a wide window, whatever touched it", () => {
    stubMatchMedia();

    press("touch");

    expect(keyboardUnasked()).toBe(false);
  });
});

describe("the editor's focus", () => {
  const content = (container: HTMLElement) => container.querySelector(".cm-content");

  it("is taken on a raised signal after a key", () => {
    stubMatchMedia({ [NARROW]: true });
    const other = document.body.appendChild(document.createElement("button"));
    other.focus();
    const { container, rerender } = render(<Editor initialDoc="" focusSignal={0} />);
    expect(content(container)).not.toHaveFocus();

    rerender(<Editor initialDoc="" focusSignal={1} />);

    expect(content(container)).toHaveFocus();
    other.remove();
  });

  it("is left alone on a phone after a tap, which would raise the keyboard", () => {
    stubMatchMedia({ [NARROW]: true });
    const { container, rerender } = render(<Editor initialDoc="" focusSignal={0} />);
    (document.activeElement as HTMLElement | null)?.blur();

    press("touch");
    rerender(<Editor initialDoc="" focusSignal={1} />);

    expect(content(container)).not.toHaveFocus();
  });

  // The tree stays open beside the note there, and its `d` trashes a row.
  it("is taken off a tree row tapped on a wide touch screen, so the next keys are the note's", () => {
    stubMatchMedia();
    const row = document.body.appendChild(document.createElement("button"));
    const { container, rerender } = render(<Editor initialDoc="" focusSignal={0} />);

    press("touch");
    row.focus();
    rerender(<Editor initialDoc="" focusSignal={1} />);

    expect(content(container)).toHaveFocus();
    row.remove();
  });

  it("is not taken on mount on a phone after a tap", () => {
    stubMatchMedia({ [NARROW]: true });
    press("touch");
    const { container } = render(<Editor initialDoc="" />);

    expect(content(container)).not.toHaveFocus();
  });

  it("is not taken on a phone when the tab comes back after a tap", () => {
    stubMatchMedia({ [NARROW]: true });
    const { container } = render(<Editor initialDoc="" focused />);
    (document.activeElement as HTMLElement | null)?.blur();

    press("touch");
    fireEvent.focus(window);
    expect(content(container)).not.toHaveFocus();

    fireEvent.keyDown(document.body, { key: "a" });
    fireEvent.focus(window);
    expect(content(container)).toHaveFocus();
  });
});
