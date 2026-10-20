/**
 * A tap or a ctrl+click on a wikilink follows it once, and only a tap in the
 * link the cursor is in edits it (#568, #569).
 *
 * The cursor in a link is a position, not a name: another link to the same
 * note is not the one being edited. And a double tap or a double ctrl+click is
 * one follow, the second click carrying `detail` 2. This runs where the
 * table-link-*.test.tsx files do: a real browser, a real finger from the
 * DevTools protocol, and the app's own editor, whose `onFollow` is a spy.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { Editor } from "@/components/editor";
import {
  type App,
  bothLanded,
  CAT,
  on,
  stubOpen,
  tapAt,
  tapCleanup,
  VIMS,
} from "./wikilink-tap-fixture";

let app: App | undefined;

tapCleanup({
  get: () => app,
  set: (next) => {
    app = next;
  },
});

describe("a tap or a press on a wikilink follows it once", () => {
  // The route keys the editor on the note's path, so a follow builds a new
  // view, and the second tap of the double tap lands in it.
  it.each(VIMS)(
    "R7 #569 a double tap on a wikilink whose note opens with a link at the same spot follows once with vim %s",
    async (vim) => {
      const notes: Record<string, string> = {
        "first.md": "A line\n[[Y]] two",
        "Y.md": "A line\n[[Z]] two",
      };
      const follow = vi.fn();
      function Notes() {
        const [path, setPath] = useState("first.md");
        return (
          <Editor
            key={path}
            path={path}
            initialDoc={notes[path] ?? ""}
            onFollow={(target) => {
              follow(target);
              setPath(`${target}.md`);
            }}
          />
        );
      }
      await page.viewport(414, 896);
      await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      localStorage.setItem("kasten.vim", vim);
      const host = document.body.appendChild(document.createElement("div"));
      host.style.cssText = "width: 100%; height: 896px;";
      const root = createRoot(host);
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <Notes />
        </QueryClientProvider>,
      );
      app = { root, host };
      await expect.poll(() => host.querySelector(".cm-wikilink")).not.toBeNull();
      // On the document: the editor the second click lands in is not the first.
      const details: number[] = [];
      const count = (event: MouseEvent) => details.push(event.detail);
      document.addEventListener("click", count, true);
      onTestFinished(() => document.removeEventListener("click", count, true));

      const point = on(host.querySelector(".cm-wikilink") as Element);
      await tapAt(point);
      await tapAt(point);
      await bothLanded(details);
      expect(host.querySelector(".cm-wikilink")?.textContent, "the note followed to").toBe("Z");
      expect(follow).toHaveBeenCalledExactlyOnceWith("Y");
    },
  );

  // As R7, the note opening with an address under the finger instead: a note
  // followed redraws the view, so the second tap is aimed at nothing in it.
  const OPENED = {
    "markdown link": { doc: "A line\n[x](https://x.com) two", selector: ".cm-link" },
    "linked picture": { doc: `A line\n[![a](${CAT})](https://x.com)`, selector: "img.cm-image" },
  } as const;

  it.each(
    (Object.keys(OPENED) as (keyof typeof OPENED)[]).flatMap((kind) =>
      VIMS.map((vim) => [kind, vim] as const),
    ),
  )(
    "R8 #572 a double tap on a wikilink whose note opens with a %s at the same spot opens no tab with vim %s",
    async (kind, vim) => {
      const notes: Record<string, string> = {
        "first.md": "A line\n[[Y]] two",
        "Y.md": OPENED[kind].doc,
      };
      const follow = vi.fn();
      function Notes() {
        const [path, setPath] = useState("first.md");
        return (
          <Editor
            key={path}
            path={path}
            initialDoc={notes[path] ?? ""}
            onFollow={(target) => {
              follow(target);
              setPath(`${target}.md`);
            }}
          />
        );
      }
      await page.viewport(414, 896);
      await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      localStorage.setItem("kasten.vim", vim);
      // The picture has no bytes before the second tap lands, so it gets its
      // size here, for that tap to land on it.
      const style = document.head.appendChild(document.createElement("style"));
      style.textContent = "img.cm-image { min-width: 320px; min-height: 180px; }";
      onTestFinished(() => style.remove());
      const host = document.body.appendChild(document.createElement("div"));
      host.style.cssText = "width: 100%; height: 896px;";
      const root = createRoot(host);
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <Notes />
        </QueryClientProvider>,
      );
      app = { root, host };
      await expect.poll(() => host.querySelector(".cm-wikilink")).not.toBeNull();
      const open = stubOpen();
      // On the document: the editor the second click lands in is not the first.
      const details: number[] = [];
      const targets: EventTarget[] = [];
      const count = (event: MouseEvent) => {
        details.push(event.detail);
        if (event.target !== null) targets.push(event.target);
      };
      document.addEventListener("click", count, true);
      onTestFinished(() => document.removeEventListener("click", count, true));

      const link = host.querySelector(".cm-wikilink") as Element;
      const box = link.getBoundingClientRect();
      const local: [number, number] = [box.left + box.width / 2, box.top + box.height / 2];
      const point = on(link);
      await tapAt(point);
      // The new note mounts in a later task than the follow, which a slow
      // runner lets the second tap beat, landing on the old view. So the
      // second waits until the new note's link is under the finger; one that
      // then comes too late for Chrome to count as the second fails below.
      await expect
        .poll(() => document.elementFromPoint(...local)?.closest(OPENED[kind].selector) ?? null, {
          message: "the new note's link under the finger",
        })
        .not.toBeNull();
      await tapAt(point);
      await bothLanded(details);
      const second = targets[1];
      expect(
        second instanceof Element && second.closest(OPENED[kind].selector) !== null,
        "the second tap on the new note's link",
      ).toBe(true);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Y");
      expect(open).not.toHaveBeenCalled();
    },
  );
});
