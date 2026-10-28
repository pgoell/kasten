// The commands `vite.config.ts` gives the frame project, typed for the tests
// that call them from the browser through `vitest/browser`.

import "vitest/browser";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateMedia: (media: {
      reducedMotion?: "reduce" | "no-preference";
      contrast?: "more" | "no-preference";
      reducedTransparency?: "reduce" | "no-preference";
      touch?: boolean;
    }) => Promise<void>;
    servePage: (path: string, html: string) => Promise<void>;
    serveFile: (path: string, file: string) => Promise<void>;
    hideResizeObserver: (path: string) => Promise<void>;
    serveSlowly: (path: string, ms: number) => Promise<void>;
    unservePages: () => Promise<void>;
    touchDrag: (points: { x: number; y: number }[]) => Promise<void>;
    touches: (frames: { id: number; x: number; y: number }[][]) => Promise<void>;
    mouseDrag: (points: { x: number; y: number }[]) => Promise<void>;
    wheel: (point: { x: number; y: number }, dy: number) => Promise<void>;
  }
}
