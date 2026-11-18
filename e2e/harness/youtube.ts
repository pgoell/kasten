import { expect, type Locator, type Page } from "@playwright/test";
import { vaultWith } from "./app.ts";

/** The frame's own origin, which the app posts to and takes messages from. */
const PLAYER = "https://www.youtube.com";

/**
 * A stand-in for YouTube's embed frame, speaking its postMessage protocol: `listening` subscribes, and each
 * delivery carries `currentTime`. A play moves the clock 30 s on, so a pause lands on start + 30, or on a seek's second + 30.
 * `window.got` keeps every command's name, for what no screen shows (volume, mute), `window.sent` each with its args.
 * `window.say` sends a delivery of the test's own, as YouTube does when its player moves to a suggestion.
 */
const FAKE_PLAYER = `<!doctype html><script>
let time = Number(new URL(location.href).searchParams.get("start") ?? 0);
window.got = [];
window.sent = [];
const send = (info) => parent.postMessage(JSON.stringify({ event: "infoDelivery", info }), "*");
window.say = send;
addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.func) window.got.push(message.func);
  if (message.func) window.sent.push({ func: message.func, args: message.args ?? [] });
  if (message.event === "listening") send({ playerState: 5, currentTime: time });
  if (message.func === "playVideo") { send({ playerState: 1, currentTime: time + 1 }); time += 30; }
  if (message.func === "pauseVideo") send({ playerState: 2, currentTime: time });
  if (message.func === "seekTo") time = message.args[0];
  if (message.func === "loadVideoById") time = message.args[1];
});
</script>`;

/**
 * Serves the fake player for every embed and aborts any other request that would leave the box.
 * Returns the aborted URLs, which a test expects to stay empty.
 */
export async function fakeYouTube(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  // Playwright tries the route added last first, so the embed is served before the catch-all sees it.
  await page.route(
    (url) => url.hostname !== "127.0.0.1" && url.hostname !== "localhost",
    (route) => {
      blocked.push(route.request().url());
      return route.abort();
    },
  );
  await page.route(`${PLAYER}/embed/**`, (route) =>
    route.fulfill({ contentType: "text/html", body: FAKE_PLAYER }),
  );
  return blocked;
}

type Sent = { func: string; args: unknown[] };

/** The frame of `pane`'s player, to read what it was sent or to speak for YouTube. */
async function playerOf(pane: Locator) {
  const frame = await (await pane.locator('iframe[title="video"]').elementHandle())?.contentFrame();
  if (!frame) throw new Error("the video pane has no player frame");
  return frame;
}

/** Each command `pane`'s player got since its frame loaded, with its args. */
export async function sentTo(pane: Locator): Promise<Sent[]> {
  return (await playerOf(pane)).evaluate(() => (window as unknown as { sent: Sent[] }).sent);
}

/** The player of `pane` delivers `info` to the app, as YouTube's frame does. */
export async function say(pane: Locator, info: object): Promise<void> {
  await (await playerOf(pane)).evaluate((i) => (window as unknown as { say: (i: object) => void }).say(i), info);
}

/** What each PUT of `path` holds in `watching: {…}`, in order, "" once the entry is dropped. */
export function watchingPuts(page: Page, path: string): string[] {
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "PUT" || !decodeURIComponent(new URL(r.url()).pathname).endsWith(path)) return;
    puts.push(/watching: \{([^}]*)\}/.exec(r.postData() ?? "")?.[1] ?? "none");
  });
  return puts;
}

/** Opens `path` holding `text` with its video beside it by the palette, as vim on or off can, and returns the pane once its player frame has loaded. */
export async function watchBeside(page: Page, vault: string, path: string, text: string): Promise<Locator> {
  await vaultWith(vault, { [path]: text });
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  // The empty last line, so the cursor sits off every line that draws a time button.
  await page.locator(".cm-content .cm-line:visible").last().click({ timeout: 15_000 });
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /Watch this note's video beside it/ }).first().click();
  const pane = page.locator("[data-video-pane]");
  await expect(pane.locator('iframe[title="video"]')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => sentTo(pane)).toEqual([]);
  return pane;
}
