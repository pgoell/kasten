import type { Page } from "@playwright/test";

/** The frame's own origin, which the app posts to and takes messages from. */
const PLAYER = "https://www.youtube.com";

/**
 * A stand-in for YouTube's embed frame, speaking its postMessage protocol: `listening` subscribes, and each
 * delivery carries `currentTime`. A play moves the clock 30 s on, so a pause lands on start + 30, or on a seek's second + 30.
 */
const FAKE_PLAYER = `<!doctype html><script>
let time = Number(new URL(location.href).searchParams.get("start") ?? 0);
const send = (info) => parent.postMessage(JSON.stringify({ event: "infoDelivery", info }), "*");
addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.event === "listening") send({ playerState: 5, currentTime: time });
  if (message.func === "playVideo") { send({ playerState: 1, currentTime: time + 1 }); time += 30; }
  if (message.func === "pauseVideo") send({ playerState: 2, currentTime: time });
  if (message.func === "seekTo") time = message.args[0];
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
