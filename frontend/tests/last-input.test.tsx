import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { lastInputWasTouch } from "@/lib/last-input";

/** A press as the browser reports it, jsdom's own pointer event carrying no type. */
function press(pointerType: string) {
  const event = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  document.body.dispatchEvent(event);
}

// A key is the last word, so no test leaves a touch behind for the next file.
afterEach(() => fireEvent.keyDown(document.body, { key: "a" }));

describe("lastInputWasTouch", () => {
  it("says yes after a finger and no after a key or a mouse", () => {
    press("touch");
    expect(lastInputWasTouch()).toBe(true);

    fireEvent.keyDown(document.body, { key: "a" });
    expect(lastInputWasTouch()).toBe(false);

    press("touch");
    press("mouse");
    expect(lastInputWasTouch()).toBe(false);
  });
});

describe("the editor's focus", () => {
  const content = (container: HTMLElement) => container.querySelector(".cm-content");

  it("is taken on a raised signal after a key", () => {
    const other = document.body.appendChild(document.createElement("button"));
    other.focus();
    const { container, rerender } = render(<Editor initialDoc="" focusSignal={0} />);
    expect(content(container)).not.toHaveFocus();

    rerender(<Editor initialDoc="" focusSignal={1} />);

    expect(content(container)).toHaveFocus();
    other.remove();
  });

  it("is left alone on a raised signal after a tap, which would raise the keyboard", () => {
    const { container, rerender } = render(<Editor initialDoc="" focusSignal={0} />);
    (document.activeElement as HTMLElement | null)?.blur();

    press("touch");
    rerender(<Editor initialDoc="" focusSignal={1} />);

    expect(content(container)).not.toHaveFocus();
  });

  it("is not taken on mount after a tap", () => {
    press("touch");
    const { container } = render(<Editor initialDoc="" />);

    expect(content(container)).not.toHaveFocus();
  });
});
