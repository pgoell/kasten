import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SwipeCard } from "@/components/review-swipe";
import { stubMatchMedia } from "./match-media";

const REDUCED = "(prefers-reduced-motion: reduce)";
const WIDTH = 390;
const EDGE = 0.38 * WIDTH;

// The gesture reads `performance.now` for its speed, so the clock is the test's:
// each event sits at the time `at` set, and a release reads the samples before it.
let clock = 0;
let vibrate: ReturnType<typeof vi.fn>;

function at(ms: number) {
  clock = ms;
}

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  // Reduced motion makes each spring jump to its end, so a release lands at once.
  stubMatchMedia({ [REDUCED]: true });
  vibrate = vi.fn();
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  // jsdom has no pointer capture, and the component asks for it once a drag is decided.
  Element.prototype.setPointerCapture = () => {};
  // jsdom has no layout, so the card is the width of a phone.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: WIDTH,
  } as DOMRect);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "vibrate");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// jsdom may have no `PointerEvent`, so a plain event carries the fields the component reads.
function pointer(
  target: Element,
  type: string,
  x: number,
  y: number,
  pointerType = "touch",
  pointerId = 1,
): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId, pointerType });
  let proceed = true;
  act(() => {
    proceed = target.dispatchEvent(event);
  });
  return proceed;
}

function renderCard({
  swipe = true,
  children = <p>Question</p>,
}: {
  swipe?: boolean;
  children?: ReactNode;
} = {}) {
  const onGrade = vi.fn();
  const onTap = vi.fn();
  const onFlight = vi.fn();
  const view = render(
    <SwipeCard swipe={swipe} onGrade={onGrade} onTap={onTap} onFlight={onFlight}>
      {children}
    </SwipeCard>,
  );
  const root = view.getByTestId("review-swipe");
  const good = root.querySelector('[data-stamp="good"]') as HTMLElement;
  const again = root.querySelector('[data-stamp="again"]') as HTMLElement;
  return { root, good, again, onGrade, onTap, onFlight };
}

it("a swipe right past 38 percent grades good once and buzzes once", async () => {
  const { root, onGrade } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 250, 300);
  at(32);
  pointer(root, "pointerup", 250, 300);

  await waitFor(() => expect(onGrade).toHaveBeenCalledWith("good"));
  expect(onGrade).toHaveBeenCalledTimes(1);
  expect(vibrate).toHaveBeenCalledTimes(1);
  expect(vibrate).toHaveBeenCalledWith(8);
});

it("a swipe left past 38 percent grades again", async () => {
  const { root, onGrade } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", -150, 300);
  at(32);
  pointer(root, "pointerup", -150, 300);

  await waitFor(() => expect(onGrade).toHaveBeenCalledWith("again"));
  expect(onGrade).toHaveBeenCalledTimes(1);
  expect(vibrate).toHaveBeenCalledTimes(1);
});

it("a short slow swipe springs back and grades nothing", () => {
  const { root, onGrade } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 130, 300);
  // Held still a long while before the release, so the finger has no speed.
  at(300);
  pointer(root, "pointerup", 130, 300);

  expect(root.style.transform).toBe("translateX(0px) rotate(0deg)");
  expect(onGrade).not.toHaveBeenCalled();
  expect(vibrate).not.toHaveBeenCalled();
});

it("a vertical move leaves the card to scrolling", async () => {
  const { root, onGrade, onTap } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 101, 340);
  at(32);
  pointer(root, "pointerup", 101, 340);

  await act(async () => {});
  expect(root.style.transform).toBe("");
  expect(onGrade).not.toHaveBeenCalled();
  expect(onTap).not.toHaveBeenCalled();
});

it("a sideways drag does nothing when swipe is off", async () => {
  const { root, onGrade, onTap } = renderCard({ swipe: false });
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 250, 300);
  at(32);
  pointer(root, "pointerup", 250, 300);

  await act(async () => {});
  expect(root.style.transform).toBe("");
  expect(onGrade).not.toHaveBeenCalled();
  expect(vibrate).not.toHaveBeenCalled();
  // A move that is past the slop is no tap either.
  expect(onTap).not.toHaveBeenCalled();
});

it("a touch tap on the card calls onTap", () => {
  const { root, onTap, onGrade } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(50);
  pointer(root, "pointerup", 100, 300);

  expect(onTap).toHaveBeenCalledTimes(1);
  expect(onGrade).not.toHaveBeenCalled();
});

it("a mouse swipe on the card does nothing", async () => {
  const { root, onGrade, onTap } = renderCard();
  pointer(root, "pointerdown", 100, 300, "mouse");
  at(16);
  pointer(root, "pointermove", 250, 300, "mouse");
  at(32);
  pointer(root, "pointerup", 250, 300, "mouse");

  await act(async () => {});
  expect(root.style.transform).toBe("");
  expect(onGrade).not.toHaveBeenCalled();
  expect(onTap).not.toHaveBeenCalled();
});

it("a tap on a link inside the card does not call onTap", () => {
  const { root, onTap } = renderCard({
    children: (
      <p>
        <a href="#elsewhere">Open the note</a>
      </p>
    ),
  });
  const link = root.querySelector("a") as HTMLElement;
  pointer(link, "pointerdown", 100, 300);
  at(50);
  pointer(link, "pointerup", 100, 300);

  expect(onTap).not.toHaveBeenCalled();
});

it("a pointer cancel mid-drag grades nothing", async () => {
  const { root, onGrade } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 250, 300);
  at(32);
  pointer(root, "pointercancel", 250, 300);

  await act(async () => {});
  expect(onGrade).not.toHaveBeenCalled();
  expect(vibrate).not.toHaveBeenCalled();
  expect(root.style.transform).toBe("translateX(0px) rotate(0deg)");
});

it("the card tilts 0.025 degrees per px in the transform mid-drag", () => {
  const { root } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 200, 300);

  expect(root.style.transform).toBe("translateX(100px) rotate(2.5deg)");
});

it("the Good stamp fades in with the drag mid-drag", () => {
  const { root, good, again } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 200, 300);

  expect(Number(good.style.opacity)).toBeCloseTo(100 / EDGE, 4);
  expect(again.style.opacity).toBe("0");
});

it("a click after a drag is swallowed", () => {
  let clicked = 0;
  const { root } = renderCard({
    children: (
      <button type="button" onClick={() => clicked++}>
        Button
      </button>
    ),
  });
  const button = root.querySelector("button") as HTMLElement;
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 130, 300);
  at(300);
  pointer(root, "pointerup", 130, 300);

  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(clicked).toBe(0);
});

it("a tap on text in a non-editable child calls onTap", () => {
  // A read-only CodeMirror view marks its content contenteditable="false", which is not a control.
  const { root, onTap } = renderCard({
    children: (
      <div contentEditable={false}>
        <p>Question text</p>
      </div>
    ),
  });
  const text = root.querySelector("p") as HTMLElement;
  pointer(text, "pointerdown", 100, 300);
  at(50);
  pointer(text, "pointerup", 100, 300);

  expect(onTap).toHaveBeenCalledTimes(1);
});

it("the flight is reported to onFlight before the grade lands", async () => {
  const { root, onGrade, onFlight } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 250, 300);
  at(32);
  pointer(root, "pointerup", 250, 300);

  await waitFor(() => expect(onGrade).toHaveBeenCalledTimes(1));
  expect(onFlight.mock.calls).toEqual([[true], [false]]);
  // A missing call reads as Infinity, so it fails the order rather than passing it.
  expect(onFlight.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY).toBeLessThan(
    onGrade.mock.invocationCallOrder[0] ?? 0,
  );
});

it("a tap on an audio control inside the card does not call onTap", () => {
  const { root, onTap } = renderCard({
    children: (
      <audio controls>
        <track kind="captions" />
      </audio>
    ),
  });
  const audio = root.querySelector("audio") as HTMLElement;
  pointer(audio, "pointerdown", 100, 300);
  at(50);
  pointer(audio, "pointerup", 100, 300);

  expect(onTap).not.toHaveBeenCalled();
});

it("a sideways drag that starts on an audio control does not move the card or grade", async () => {
  const { root, onGrade } = renderCard({
    children: (
      <audio controls>
        <track kind="captions" />
      </audio>
    ),
  });
  const audio = root.querySelector("audio") as HTMLElement;
  pointer(audio, "pointerdown", 100, 300);
  at(16);
  pointer(audio, "pointermove", 250, 300);
  at(32);
  pointer(audio, "pointerup", 250, 300);

  await act(async () => {});
  expect(root.style.transform).toBe("");
  expect(onGrade).not.toHaveBeenCalled();
});

it("a sideways drag that starts on a link grades and swallows the click after it", async () => {
  let clicked = 0;
  const { root, onGrade } = renderCard({
    children: (
      <p>
        <a href="#elsewhere">Open the note</a>
      </p>
    ),
  });
  const link = root.querySelector("a") as HTMLElement;
  link.addEventListener("click", () => clicked++);
  pointer(link, "pointerdown", 100, 300);
  at(16);
  pointer(link, "pointermove", 250, 300);
  at(32);
  pointer(link, "pointerup", 250, 300);

  await waitFor(() => expect(onGrade).toHaveBeenCalledWith("good"));
  act(() => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(clicked).toBe(0);
});

it("a horizontal touch move after the drag is decided is default prevented", () => {
  const { root } = renderCard();
  pointer(root, "pointerdown", 100, 300);
  at(16);
  pointer(root, "pointermove", 250, 300);

  const move = new Event("touchmove", { bubbles: true, cancelable: true });
  root.dispatchEvent(move);
  expect(move.defaultPrevented).toBe(true);
});
