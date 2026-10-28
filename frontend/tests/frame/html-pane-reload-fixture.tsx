/**
 * The helpers the html pane's reload tests share (#1277, #1293): the panes drawn
 * over served pages, and a rewrite the vault announces as the route's event
 * stream does on a `page` event. The frame is new after a reload, so each helper
 * reads it again.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { commands as browser } from "vitest/browser";
import { HtmlPane } from "@/components/html-pane";
import { Toolbar } from "@/components/toolbar";
import { WhichKey } from "@/components/which-key";
import { pageWritten } from "@/lib/html/page-written";
import { ask, frameOf, type Mounted, ready } from "./html-take-fixture";
import { page as pageOf } from "./html-take-pages";

/** Answers which version of the page is drawn, by its title. */
export const WHICH = `<script>addEventListener("message", (event) => {
  if (event.source === parent && event.data?.probe === "which") parent.postMessage({ fixture: "which", title: document.title }, "*");
});</script>`;

/** A page tall enough to scroll, with a heading far down for a link to name. */
export function report(title: string): string {
  return pageOf(
    title,
    `<p id="p1">Alpha bravo charlie delta echo.</p><div style="height:1500px"></div><h2 id="far">Far</h2><div style="height:3000px"></div>${WHICH}`,
  );
}

/** An image `serveSlowly` answers late, which holds the load of a page that shows it. */
export const SLOW = "slow.gif";

/** A page whose script runs at once and whose load waits on `SLOW`. */
export function late(title: string): string {
  return pageOf(title, `<p id="p1">Alpha bravo charlie delta echo.</p><img src="${SLOW}">${WHICH}`);
}

/** One pane per path, the phone's toolbar when asked, and the heading a link named. */
export function renderPanes(
  mounted: Mounted,
  paths: string[],
  { phone = false, anchor }: { phone?: boolean; anchor?: string },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() =>
    mounted.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-dvh flex-col">
          <div className="flex min-h-0 flex-1">
            {paths.map((path, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: keyed by place, so a pane moved to another page keeps its HtmlPane, as the app's does
              <div key={index} data-pane className="min-w-0 flex-1">
                <HtmlPane path={path} anchor={anchor} commands={mounted.spy} onFocus={() => {}} />
              </div>
            ))}
          </div>
          {phone && <Toolbar commands={mounted.spy} split={paths.length > 1} />}
          <WhichKey phone={phone} />
        </div>
      </QueryClientProvider>,
    ),
  );
}

export async function titleOf(frame: HTMLIFrameElement): Promise<unknown> {
  return (await ask(frame, { probe: "which" }, "which")).title;
}

/**
 * Rewrites the page on disk and tells the panes, then waits for the new frame's
 * script. Answers a wait for the new frame's load, which can come well after its
 * script has run.
 */
export async function swap(
  mounted: Mounted,
  path: string,
  html: string,
  index: number,
): Promise<() => Promise<void>> {
  await browser.servePage(path, html);
  // Load does not bubble, so it is heard on the way down, before the pane's own `onLoad`.
  const loaded = new Set<EventTarget | null>();
  const onLoad = (event: Event) => loaded.add(event.target);
  mounted.host.addEventListener("load", onLoad, true);
  const before = frameOf(mounted, index);
  pageWritten(path);
  await expect.poll(() => frameOf(mounted, index)).not.toBe(before);
  await ready(frameOf(mounted, index));
  return async () => {
    await expect.poll(() => loaded.has(frameOf(mounted, index)), { timeout: 4000 }).toBe(true);
    mounted.host.removeEventListener("load", onLoad, true);
  };
}

/**
 * Rewrites the page and waits for the new frame's load, where the pane restores the
 * scroll and the focus: its script says hello before that.
 */
export async function rewrite(mounted: Mounted, path: string, html: string, index: number) {
  await (await swap(mounted, path, html, index))();
}
