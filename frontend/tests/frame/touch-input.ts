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

/** A mouse wheel over a point, `dy` px down. */
export const wheel: BrowserCommand<[Point, number]> = async (context, point, dy) => {
  const at = await offset(context);
  await context.page.mouse.move(point.x + at.x, point.y + at.y);
  await context.page.mouse.wheel(0, dy);
};
