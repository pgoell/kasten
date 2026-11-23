import type { Locator, Page } from "@playwright/test";
import { leader } from "../../../../harness/app.ts";
import { expect } from "../../../../harness/stack.ts";

/** A talk on kastenVid01 whose transcript has a paragraph every 10 s, enough to fill the column. */
export function talkWith(more = ""): string {
  const rows = Array.from({ length: 40 }, (_, n) => {
    const at = `${String(Math.floor(n / 6)).padStart(2, "0")}:${String((n % 6) * 10).padStart(2, "0")}`;
    return `[${at}] Passage ${n} of the video.`;
  });
  return `# Talk\n\n[The talk](https://youtu.be/kastenVid01)\n${more}\n## Transcript\n\n${rows.join("\n\n")}\n`;
}

/** Opens the open note's video in Video view and returns the pane. */
export async function videoView(page: Page): Promise<Locator> {
  await leader(page, "gv");
  const pane = page.locator("[data-video-pane]");
  await pane.getByRole("button", { name: "Video view" }).click();
  await expect(pane.getByRole("list", { name: "Transcript" })).toBeVisible({ timeout: 15_000 });
  return pane;
}

/**
 * Selects the words of a transcript paragraph in sight and takes them: the first one for "first",
 * or for "low" one whose middle sits in the lower half of the box the toast sits in, measured
 * as it is selected, so the follow scroll cannot move it first. Returns the words.
 */
export async function take(pane: Locator, where: "first" | "low"): Promise<string> {
  const words = await pane.getByRole("list", { name: "Transcript" }).evaluate((list, low) => {
    // The toast's box is the transcript's own wrapper, the one `low()` measures in.
    const box = (list.parentElement as HTMLElement).getBoundingClientRect();
    const seen = list.getBoundingClientRect();
    const fits = (r: DOMRect) => {
      const middle = (r.top + r.bottom) / 2;
      const inSight = r.top >= seen.top && r.bottom <= seen.bottom;
      const lower = middle > (box.top + box.bottom) / 2 + 20 && middle < box.bottom - 20;
      return inSight && (!low || lower);
    };
    const li = [...list.querySelectorAll("li")].find((row) => fits(row.getBoundingClientRect()));
    // The words are the text after the time's button, so the selection holds them alone.
    const node = [...(li?.querySelector("p")?.childNodes ?? [])].find((n) =>
      (n.textContent ?? "").includes("Passage"),
    );
    if (node === undefined) throw new Error("no paragraph in sight fits");
    const range = document.createRange();
    range.selectNodeContents(node);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    return (node.textContent ?? "").trim();
  }, where === "low");
  await pane.getByRole("button", { name: "Take the passage" }).click();
  return words;
}
