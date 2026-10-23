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
    unservePages: () => Promise<void>;
  }
}
