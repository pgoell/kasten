/**
 * Input the browser itself takes for a finger's or a wheel's, through the
 * DevTools protocol, so it scrolls the way a real one does: a `TouchEvent` made
 * in the page reaches the listeners but never moves a scroll box. Registered in
 * `vite.config.ts`, and typed in `browser-commands.d.ts`. Points are in the
 * test's frame, which the runner places inside its own page at scale 1.
 */

import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

interface Point {
  x: number;
  y: number;
}

/** Where the test's frame sits in the page the protocol's points are read in. */
async function offset(context: BrowserCommandContext): Promise<Point> {
  const frame = await (
    context as unknown as {
      frame(): Promise<{ frameElement(): Promise<{ boundingBox(): Promise<Point | null> }> }>;
    }
  ).frame();
  const box = await (await frame.frameElement()).boundingBox();
  return { x: box?.x ?? 0, y: box?.y ?? 0 };
}

/** One finger down at the first point, through every other, and up at the last. */
export const touchDrag: BrowserCommand<[Point[]]> = async (context, points) => {
  const { page } = context;
  const at = await offset(context);
  const session = await context.context.newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", point?: Point) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point === undefined ? [] : [{ x: point.x + at.x, y: point.y + at.y }],
    });
  const [first, ...rest] = points;
  if (first === undefined) return;
  await send("touchStart", first);
  for (const point of rest) await send("touchMove", point);
  await send("touchEnd");
  await session.detach();
};

/** A finger of `touches`: the same `id` from the frame it goes down in to the one it lifts in. */
interface Finger extends Point {
  id: number;
}

/**
 * Several fingers, frame by frame: each frame lists the fingers down, so a frame
 * with one more puts a finger down, one with fewer lifts the ones it leaves out,
 * and one with the same moves them. Every finger still down is lifted at the end.
 */
export const touches: BrowserCommand<[Finger[][]]> = async (context, frames) => {
  const at = await offset(context);
  const session = await context.context.newCDPSession(context.page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", points: Finger[]) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map(({ id, x, y }) => ({ id, x: x + at.x, y: y + at.y })),
    });
  let previous: Finger[] = [];
  for (const frame of frames) {
    // An end lifts the fingers it names, and the rest stay down.
    const lifted = previous.filter((finger) => !frame.some((one) => one.id === finger.id));
    if (lifted.length > 0) await send("touchEnd", lifted);
    else await send(frame.length > previous.length ? "touchStart" : "touchMove", frame);
    previous = frame;
  }
  if (previous.length > 0) await send("touchEnd", []);
  await session.detach();
};

/** The mouse's left button down at the first point, through every other, and up at the last. */
export const mouseDrag: BrowserCommand<[Point[]]> = async (context, points) => {
  const at = await offset(context);
  const { mouse } = context.page;
  const [first, ...rest] = points;
  if (first === undefined) return;
  await mouse.move(first.x + at.x, first.y + at.y);
  await mouse.down();
  for (const point of rest) await mouse.move(point.x + at.x, point.y + at.y);
  await mouse.up();
};

/** A mouse wheel over a point, `dy` px down. */
export const wheel: BrowserCommand<[Point, number]> = async (context, point, dy) => {
  const at = await offset(context);
  await context.page.mouse.move(point.x + at.x, point.y + at.y);
  await context.page.mouse.wheel(0, dy);
};
