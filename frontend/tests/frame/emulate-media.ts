/**
 * The browser command the frame project answers media queries with, read by
 * the tests through `commands.emulateMedia` in `vitest/browser`. Registered in
 * `vite.config.ts`, and typed in `browser-commands.d.ts`.
 */

import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

/** The media a frame test asks the browser to answer as. A field left out reads as no preference. */
interface EmulatedMedia {
  reducedMotion?: "reduce" | "no-preference";
  contrast?: "more" | "no-preference";
  reducedTransparency?: "reduce" | "no-preference";
  /** A finger's pointer, which is what makes `(pointer: coarse)` match. */
  touch?: boolean;
}

type Session = Awaited<ReturnType<BrowserCommandContext["context"]["newCDPSession"]>>;

/**
 * One CDP session per page, kept for the page's life, because the browser
 * drops an emulation with the session that set it.
 */
const sessions = new WeakMap<object, Session>();

/**
 * Answers the media queries a test asks about, in the browser itself.
 *
 * Playwright's own `emulateMedia` has no reduced transparency, and a later
 * `Emulation.setEmulatedMedia` replaces the features an earlier one set. So
 * every feature goes in one call, and the whole answer is restated each time.
 */
export const emulateMedia: BrowserCommand<[EmulatedMedia]> = async ({ page, context }, media) => {
  let session = sessions.get(page);
  if (!session) {
    session = await context.newCDPSession(page);
    sessions.set(page, session);
  }
  await session.send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: media.reducedMotion ?? "no-preference" },
      { name: "prefers-contrast", value: media.contrast ?? "no-preference" },
      { name: "prefers-reduced-transparency", value: media.reducedTransparency ?? "no-preference" },
    ],
  });
  // A touch screen is off until asked for, and a laptop must not read as one by accident.
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: media.touch ?? false,
    // The protocol refuses zero, so off is one point with touch emulation disabled.
    maxTouchPoints: media.touch ? 5 : 1,
  });
};
