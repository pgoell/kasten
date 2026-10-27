import { afterEach, expect, it, vi } from "vitest";
import { gradeTick } from "@/lib/review/haptic";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("gradeTick vibrates once for 8 ms", () => {
  const vibrate = vi.fn(() => true);
  vi.stubGlobal("navigator", { vibrate });

  gradeTick();

  expect(vibrate).toHaveBeenCalledTimes(1);
  expect(vibrate).toHaveBeenCalledWith(8);
});

it("gradeTick does nothing where navigator has no vibrate", () => {
  vi.stubGlobal("navigator", {});

  expect(() => gradeTick()).not.toThrow();
});
