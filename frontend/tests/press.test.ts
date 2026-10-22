import { startPress } from "@/lib/press";

const at = (id: string) => document.getElementById(id) as HTMLElement;

// A MouseEvent carries `button`, which the listener reads: it is 0 for the
// primary button, as a real pointer's is. `lostpointercapture` does not bubble,
// which the capture phase on the document does not need.
const fire = (target: Element, type: string) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));

let stop: () => void;

beforeEach(() => {
  document.body.innerHTML = `
    <button id="go" type="button">Go</button>
    <button id="off" type="button" disabled>Off</button>
    <button id="aria" type="button" aria-disabled="true">Aria</button>
    <button id="wrap" type="button"><span id="inner">Inner</span></button>
  `;
  stop = startPress();
});

afterEach(() => {
  stop();
});

describe("startPress", () => {
  it("a pointerdown on a button marks it pressed", () => {
    fire(at("go"), "pointerdown");

    expect(at("go")).toHaveAttribute("data-pressed");
  });

  it("a right-button press does not mark the control", () => {
    // Chrome opens the context menu on the mousedown and never sends the
    // pointerup, so a marked control would stay at its pressed scale.
    at("go").dispatchEvent(
      new MouseEvent("pointerdown", { button: 2, bubbles: true, cancelable: true }),
    );

    expect(at("go")).not.toHaveAttribute("data-pressed");
  });

  it("a context menu lifts the mark", () => {
    fire(at("go"), "pointerdown");
    fire(at("go"), "contextmenu");

    expect(at("go")).not.toHaveAttribute("data-pressed");
  });

  it("a pointerup lifts the mark", () => {
    fire(at("go"), "pointerdown");
    fire(at("go"), "pointerup");

    expect(at("go")).not.toHaveAttribute("data-pressed");
  });

  it("a pointercancel lifts the mark, so a touch that turns into a scroll lets go", () => {
    fire(at("go"), "pointerdown");
    fire(at("go"), "pointercancel");

    expect(at("go")).not.toHaveAttribute("data-pressed");
  });

  it("a lost pointer capture lifts the mark", () => {
    fire(at("go"), "pointerdown");
    fire(at("go"), "lostpointercapture");

    expect(at("go")).not.toHaveAttribute("data-pressed");
  });

  it("a disabled button, or one with aria-disabled, is not marked", () => {
    fire(at("off"), "pointerdown");
    fire(at("aria"), "pointerdown");

    expect(at("off")).not.toHaveAttribute("data-pressed");
    expect(at("aria")).not.toHaveAttribute("data-pressed");
  });

  it("a press on a span inside a button marks the button", () => {
    fire(at("inner"), "pointerdown");

    expect(at("wrap")).toHaveAttribute("data-pressed");
    expect(at("inner")).not.toHaveAttribute("data-pressed");
  });

  it("unsubscribing stops the marking", () => {
    stop();
    fire(at("go"), "pointerdown");

    expect(at("go")).not.toHaveAttribute("data-pressed");
  });
});
