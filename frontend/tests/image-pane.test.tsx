import { act, fireEvent, render, screen } from "@testing-library/react";
import { gesture, ImagePane } from "@/components/image-pane";
import { stubCommands } from "./stub-commands";

const SHOT = "99 Misc/02 Assets/01 Images/2026-08-12-abcdef01.png";

function open(path = SHOT) {
  const commands = stubCommands();
  const onDelete = vi.fn();
  const { container } = render(
    <ImagePane path={path} commands={commands} focusSignal={1} onDelete={onDelete} />,
  );
  const pane = container.querySelector("[data-image-pane]") as HTMLElement;
  return { commands, onDelete, pane };
}

/** The box the picture sits in, which is what takes the fingers. */
function surface() {
  return screen.getByRole("img").parentElement as HTMLElement;
}

function transform() {
  return screen.getByRole("img").style.transform;
}

/** Two fingers down 100 apart around the origin, then spread to 200. */
function pinchOut() {
  fireEvent.pointerDown(surface(), { pointerId: 1, clientX: -50, clientY: 0 });
  fireEvent.pointerDown(surface(), { pointerId: 2, clientX: 50, clientY: 0 });
  fireEvent.pointerMove(surface(), { pointerId: 1, clientX: -150, clientY: 0 });
}

describe("gesture", () => {
  const centre = { x: 100, y: 100 };
  const size = { x: 200, y: 200 };
  const fitted = { scale: 1, x: 0, y: 0 };

  it("scales by the ratio of the distances and keeps the midpoint where it was", () => {
    // The midpoint is 40 right of the centre, so doubling pushes the picture's
    // middle 40 left to keep that point under the fingers.
    const next = gesture(
      fitted,
      [
        { x: 120, y: 100 },
        { x: 160, y: 100 },
      ],
      [
        { x: 100, y: 100 },
        { x: 180, y: 100 },
      ],
      centre,
      size,
    );

    expect(next).toEqual({ scale: 2, x: -40, y: 0 });
  });

  it("carries the picture along when both fingers move together", () => {
    const next = gesture(
      { scale: 2, x: 0, y: 0 },
      [
        { x: 90, y: 100 },
        { x: 110, y: 100 },
      ],
      [
        { x: 100, y: 130 },
        { x: 120, y: 130 },
      ],
      centre,
      size,
    );

    expect(next).toEqual({ scale: 2, x: 10, y: 30 });
  });

  it("stops at fitted and at eight times, and fitted is centred", () => {
    const apart = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const close = [
      { x: 45, y: 0 },
      { x: 55, y: 0 },
    ];

    expect(gesture({ scale: 2, x: 30, y: 30 }, apart, close, centre, size)).toEqual(fitted);
    expect(gesture({ scale: 4, x: 0, y: 0 }, close, apart, centre, size).scale).toBe(8);
  });

  it("drags a zoomed picture with one pointer and leaves a fitted one alone", () => {
    const before = [{ x: 10, y: 10 }];
    const after = [{ x: 25, y: 5 }];

    expect(gesture({ scale: 2, x: 1, y: 1 }, before, after, centre, size)).toEqual({
      scale: 2,
      x: 16,
      y: -4,
    });
    expect(gesture(fitted, before, after, centre, size)).toBe(fitted);
  });

  it("stops a drag where the picture's edge meets the box's", () => {
    // Twice the box hangs half the box over each side: 100 of 200, 50 of 100.
    const far = gesture({ scale: 2, x: 0, y: 0 }, [{ x: 0, y: 0 }], [{ x: 900, y: -900 }], centre, {
      x: 200,
      y: 100,
    });

    expect(far).toEqual({ scale: 2, x: 100, y: -50 });
  });

  it("stops a pinch that moves there too", () => {
    const next = gesture(
      { scale: 2, x: 0, y: 0 },
      [
        { x: 90, y: 100 },
        { x: 110, y: 100 },
      ],
      [
        { x: 590, y: 100 },
        { x: 610, y: 100 },
      ],
      centre,
      size,
    );

    expect(next).toEqual({ scale: 2, x: 100, y: 0 });
  });

  it("ignores two pointers on one spot", () => {
    const spot = { x: 5, y: 5 };

    expect(gesture(fitted, [spot, spot], [{ x: 0, y: 0 }, spot], centre, size)).toBe(fitted);
  });
});

describe("the image pane by touch", () => {
  beforeEach(() => {
    // jsdom has no pointer capture.
    HTMLElement.prototype.setPointerCapture = vi.fn();
    // Nor a layout: every box measures nothing, which would hold the picture
    // at the middle. 400 square around the origin, so the centre stays there.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: -200,
      top: -200,
      width: 400,
      height: 400,
    } as DOMRect);
  });

  afterEach(() => vi.restoreAllMocks());

  it("starts fitted, on a surface the browser does not scroll or zoom", () => {
    open();

    expect(transform()).toBe("translate(0px, 0px) scale(1)");
    expect(surface()).toHaveClass("touch-none");
    expect(screen.getByRole("img")).toHaveAttribute("draggable", "false");
  });

  it("zooms on a pinch, and captures each pointer", () => {
    open();

    pinchOut();

    // jsdom has no layout, so the box's centre is the origin and the midpoint
    // moved from 0 to -50.
    expect(transform()).toBe("translate(-50px, 0px) scale(2)");
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(1);
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(2);
  });

  it("leaves a fitted picture where it is under one pointer", () => {
    open();

    fireEvent.pointerDown(surface(), { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 40, clientY: 40 });

    expect(transform()).toBe("translate(0px, 0px) scale(1)");
  });

  it("pans a zoomed picture with the finger left down", () => {
    open();
    pinchOut();

    fireEvent.pointerUp(surface(), { pointerId: 2 });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: -140, clientY: 20 });

    expect(transform()).toBe("translate(-40px, 20px) scale(2)");
  });

  it("keeps a zoomed picture's edge in the box however far the finger goes", () => {
    open();
    pinchOut();

    fireEvent.pointerUp(surface(), { pointerId: 2 });
    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 5000, clientY: -5000 });

    expect(transform()).toBe("translate(200px, -200px) scale(2)");
  });

  it("leaves a mouse alone on a fitted picture, and lets it drag a zoomed one", () => {
    open();
    const mouse = { pointerId: 9, pointerType: "mouse" };

    fireEvent.pointerDown(surface(), { ...mouse, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(surface(), { ...mouse, clientX: 40, clientY: 40 });
    fireEvent.pointerUp(surface(), mouse);

    expect(HTMLElement.prototype.setPointerCapture).not.toHaveBeenCalled();

    pinchOut();
    fireEvent.pointerUp(surface(), { pointerId: 1 });
    fireEvent.pointerUp(surface(), { pointerId: 2 });
    fireEvent.pointerDown(surface(), { ...mouse, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(surface(), { ...mouse, clientX: 10, clientY: 20 });

    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalledWith(9);
    expect(transform()).toBe("translate(-40px, 20px) scale(2)");
  });

  it("forgets a cancelled pointer, so the next finger does not pinch against it", () => {
    open();
    pinchOut();

    fireEvent.pointerCancel(surface(), { pointerId: 1 });
    fireEvent.pointerCancel(surface(), { pointerId: 2 });
    fireEvent.pointerDown(surface(), { pointerId: 3, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(surface(), { pointerId: 3, clientX: 10, clientY: 0 });

    expect(transform()).toBe("translate(-40px, 0px) scale(2)");
  });

  it("ignores a pointer that moves without being down, which is a mouse", () => {
    open();
    pinchOut();
    fireEvent.pointerUp(surface(), { pointerId: 1 });
    fireEvent.pointerUp(surface(), { pointerId: 2 });

    fireEvent.pointerMove(surface(), { pointerId: 1, clientX: 300, clientY: 300 });

    expect(transform()).toBe("translate(-50px, 0px) scale(2)");
  });

  it("shows the next picture fitted", () => {
    const { rerender } = render(
      <ImagePane path={SHOT} commands={stubCommands()} onDelete={vi.fn()} />,
    );
    pinchOut();

    rerender(<ImagePane path="other.png" commands={stubCommands()} onDelete={vi.fn()} />);

    expect(transform()).toBe("translate(0px, 0px) scale(1)");
  });
});

describe("the image pane", () => {
  it("shows the image the vault serves, with the path above it", () => {
    open();

    const image = screen.getByRole("img") as HTMLImageElement;
    // Percent-encoded, the folders carrying spaces, and the slashes left alone.
    expect(image.getAttribute("src")).toBe(`/api/assets/${encodeURI(SHOT)}`);
    expect(image.alt).toBe("2026-08-12-abcdef01.png");
    expect(screen.getByText(SHOT)).toBeInTheDocument();
  });

  it("says so when there is no image at the path", () => {
    open();

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByRole("alert")).toHaveTextContent(SHOT);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("takes the focus when the pane is moved to, so the keys land here", () => {
    const { pane } = open();

    expect(document.activeElement).toBe(pane);
  });

  it("closes the pane on the leader then q", () => {
    const { commands, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "q" });

    expect(commands.closeNote).toHaveBeenCalledTimes(1);
  });

  it("moves the image into the trash on d, the way the tree does", () => {
    const { onDelete, pane } = open();

    fireEvent.keyDown(pane, { key: "d" });

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("leaves d to the leader when a sequence is open", () => {
    // `<leader>df` deletes the note in the focused pane, and this pane holds no
    // note: what matters is that the sequence swallows the `d` rather than the
    // bare key taking it.
    const { onDelete, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "d" });

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("reaches a two-letter leader sequence, waiting for the second key", () => {
    const { commands, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "g" });
    expect(commands.openDaily).not.toHaveBeenCalled();

    fireEvent.keyDown(pane, { key: "d" });

    expect(commands.openDaily).toHaveBeenCalledTimes(1);
  });

  // jsdom applies no media query, so the button is in the tree either way and
  // the class is what keeps it off a screen with a mouse.
  it("deletes on the second tap of its button, which only a finger is shown", () => {
    const { onDelete } = open();
    const button = screen.getByRole("button", { name: "delete" });
    expect(button).toHaveClass("hidden", "pointer-coarse:block", "min-h-11");

    fireEvent.click(button);
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "delete?" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("stops asking once the tap goes somewhere else", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "delete" }));

    fireEvent.pointerDown(surface());

    expect(screen.getByRole("button", { name: "delete" })).toBeInTheDocument();
  });

  it("stops asking after five seconds, so a later tap does not delete unasked", () => {
    vi.useFakeTimers();
    const { onDelete } = open();
    fireEvent.click(screen.getByRole("button", { name: "delete" }));

    act(() => vi.advanceTimersByTime(5000));
    fireEvent.click(screen.getByRole("button", { name: "delete" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "delete?" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});
