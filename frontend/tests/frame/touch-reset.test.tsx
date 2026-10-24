/**
 * `emulateMedia({})` clears touch that a test turned on through `cdp()` (#919).
 *
 * Most frame tests turn touch on with their own DevTools session, while
 * `emulateMedia` keeps a session of its own per page. If the reset went through
 * that other session, touch would stay on after it, and the next test would
 * start on a phone. This test checks the reset in a real browser, where
 * `pointer: coarse` is what touch changes.
 */

// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { cdp, commands } from "vitest/browser";

const COARSE = "(pointer: coarse)";

async function setTouch(enabled: boolean) {
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled, maxTouchPoints: 5 });
}

afterEach(async () => {
  await setTouch(false);
});

test("#919 A4 emulateMedia({}) clears touch turned on through cdp()", async () => {
  await setTouch(true);
  expect(matchMedia(COARSE).matches).toBe(true);

  await commands.emulateMedia({});

  expect(matchMedia(COARSE).matches).toBe(false);
});
