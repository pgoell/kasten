/**
 * The page script inside a real frame, with no pane around it (#785).
 *
 * The frame is sandboxed the way `html-pane.tsx` sandboxes one, and each page
 * comes from `servePage`, which appends the script the way `read_html` does.
 * The keys are real ones pressed in Chromium, since a frame's key handling is
 * what jsdom cannot show.
 */

import { commands, userEvent } from "vitest/browser";

/** The path `servePage` answers for, and the frame loads. */
const PAGE = "fixture.html";

/** What a fixture posts back. `y` is set on the scroll answer, `value` on a field's input. */
interface Message {
  kasten?: string;
  key?: string;
  fixture?: string;
  y?: number;
  value?: string;
  prevented?: boolean;
  atWindow?: boolean;
}

/**
 * Every fixture carries this, so a test can see what reached the page.
 *
 * `keydown` is reported in the bubble phase, so a key kasten stopped never
 * shows up in it. That is how a test knows kasten took the key. The frame posts
 * in order, so a letter pressed last is a barrier: once it has been reported,
 * everything pressed before it has been posted.
 */
const REPORT = `<script>
addEventListener("keydown", (event) => parent.postMessage({ fixture: "keydown", key: event.key }, "*"));
addEventListener("message", () => parent.postMessage({ fixture: "scroll", y: scrollY }, "*"));
</script>`;

/** Tall enough to scroll, and nothing else, so a key that scrolls moves `scrollY`. */
const TALL = `<!doctype html><title>tall</title><body><div style="height:3000px"></div>${REPORT}</body>`;

/** A page that handles `j` itself and says so. */
const OWN_J = `<!doctype html><title>own j</title><body><div style="height:3000px"></div>${REPORT}<script>
addEventListener("keydown", (event) => {
  if (event.key === "j") {
    event.preventDefault();
    parent.postMessage({ fixture: "own-j" }, "*");
  }
});
</script></body>`;

/** A page that catches Space itself and says so. */
const CATCHES_SPACE = `<!doctype html><title>catches</title><body><div style="height:3000px"></div>${REPORT}<script>
addEventListener("keydown", (event) => {
  if (event.key === " ") parent.postMessage({ fixture: "caught" }, "*");
});
</script></body>`;

/**
 * A page opened in a tab of its own. Its window hears a space the test dispatches
 * on load, and reports whether that space came back prevented.
 */
const TAB_OWN = `<!doctype html><title>tab</title><body><script>
let atWindow;
addEventListener("keydown", (event) => { atWindow = event.defaultPrevented; });
addEventListener("load", () => {
  const event = new KeyboardEvent("keydown", { key: " ", cancelable: true, bubbles: true });
  document.body.dispatchEvent(event);
  opener.postMessage({ fixture: "i3", prevented: event.defaultPrevented, atWindow }, "*");
});
</script></body>`;

const FIELD_STYLE =
  "position:fixed;inset:0;width:100%;height:100%;box-sizing:border-box;margin:0;font:32px sans-serif";

/** A page whose one control fills the frame, so a click at its centre lands in it. */
function field(control: string): string {
  return `<!doctype html><title>field</title><body>${control}${REPORT}<script>
const field = document.querySelector("#field");
field.addEventListener("input", () => parent.postMessage({ fixture: "value", value: field.value }, "*"));
</script></body>`;
}

let frame: HTMLIFrameElement | undefined;
const messages: Message[] = [];

window.addEventListener("message", (event: MessageEvent<Message>) => {
  if (frame && event.source === frame.contentWindow) messages.push(event.data);
});

afterEach(async () => {
  frame?.remove();
  frame = undefined;
  messages.length = 0;
  await commands.unservePages();
});

/** Serve `html` as the page, and draw it in a frame sandboxed the way the pane sandboxes one. */
async function mount(html: string): Promise<HTMLIFrameElement> {
  await commands.servePage(PAGE, html);
  const element = document.createElement("iframe");
  element.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
  element.style.cssText = "position:fixed;top:0;left:0;width:800px;height:400px;border:0";
  const loaded = new Promise((resolve) =>
    element.addEventListener("load", resolve, { once: true }),
  );
  element.src = `/api/html/${PAGE}`;
  frame = element;
  document.body.append(element);
  await loaded;
  return element;
}

/** The keys kasten was sent, in the order the frame posted them. */
function keysSent(): (string | undefined)[] {
  return messages.filter((m) => m.kasten === "key").map((m) => m.key);
}

/** Whether the page saw `key` reach its own window. */
function reported(key: string): boolean {
  return messages.some((m) => m.fixture === "keydown" && m.key === key);
}

/** The page's scroll position, asked for and waited on, since a frame's DOM is out of reach. */
async function scrollY(): Promise<number | undefined> {
  const before = messages.length;
  frame?.contentWindow?.postMessage("read", "*");
  await expect.poll(() => messages.slice(before).some((m) => m.fixture === "scroll")).toBe(true);
  return messages.slice(before).find((m) => m.fixture === "scroll")?.y;
}

/** Type Space, `?` and Escape into a field, and check the page kept them and kasten got none. */
async function typeInField(control: string) {
  const element = await mount(field(control));
  await userEvent.click(element);
  await userEvent.keyboard(" ");
  await userEvent.keyboard("?");
  await userEvent.keyboard("{Escape}");

  await expect.poll(() => reported("Escape")).toBe(true);
  const values = messages.filter((m) => m.fixture === "value");
  expect(values.at(-1)?.value).toBe(" ?");
  expect(keysSent()).toEqual([]);
}

it("posts hello once the page has loaded", async () => {
  await mount(TALL);

  await expect.poll(() => messages).toContainEqual({ kasten: "hello" });
});

it("posts hello on a page with no body tag", async () => {
  await mount(`<!doctype html><title>plain</title><p>no body</p>`);

  await expect.poll(() => messages).toContainEqual({ kasten: "hello" });
});

it("posts Space, ? and Escape to kasten, and the page does not scroll on Space", async () => {
  const element = await mount(TALL);
  await userEvent.click(element);

  await userEvent.keyboard(" ");
  await userEvent.keyboard("?");
  await userEvent.keyboard("{Escape}");

  await expect.poll(keysSent).toEqual([" ", "?", "Escape"]);
  expect(await scrollY()).toBe(0);
});

it("j and k scroll the page 64 pixels a press, and k scrolls back", async () => {
  const element = await mount(TALL);
  await userEvent.click(element);

  await userEvent.keyboard("j");
  await expect.poll(scrollY).toBe(64);
  await userEvent.keyboard("k");
  await expect.poll(scrollY).toBe(0);
});

it("Ctrl+Space goes to the page and the browser, and kasten is not sent it", async () => {
  const element = await mount(TALL);
  await userEvent.click(element);

  await userEvent.keyboard("{Control>} {/Control}");
  await userEvent.keyboard("a");

  await expect.poll(() => reported("a")).toBe(true);
  expect(keysSent()).toEqual([]);
});

it("a page that catches Space itself does not see it, and kasten still gets it", async () => {
  const element = await mount(CATCHES_SPACE);
  await userEvent.click(element);

  await userEvent.keyboard(" ");
  await userEvent.keyboard("a");

  await expect.poll(() => reported("a")).toBe(true);
  expect(keysSent()).toEqual([" "]);
  expect(messages.some((m) => m.fixture === "caught")).toBe(false);
});

it("a j the page handles itself is not scrolled a second time", async () => {
  const element = await mount(OWN_J);
  await userEvent.click(element);

  await userEvent.keyboard("j");

  await expect.poll(() => messages.some((m) => m.fixture === "own-j")).toBe(true);
  expect(await scrollY()).toBe(0);
});

it("in a text input, Space, ? and Escape stay the page's", async () => {
  await typeInField(`<input id="field" style="${FIELD_STYLE}">`);
});

it("in a textarea, Space, ? and Escape stay the page's", async () => {
  await typeInField(`<textarea id="field" style="${FIELD_STYLE}"></textarea>`);
});

it("in a tab of its own, the script stops no default and posts nothing", async () => {
  await commands.servePage(PAGE, TAB_OWN);
  // A popup is top level, so its `window.parent` is itself and the script returns at once.
  const popup = window.open(`/api/html/${PAGE}`);
  expect(popup).not.toBeNull();
  const heard: Message[] = [];
  const hear = (event: MessageEvent<Message>) => {
    if (event.source === popup) heard.push(event.data);
  };
  window.addEventListener("message", hear);
  try {
    await expect.poll(() => heard.some((m) => m.fixture === "i3")).toBe(true);
    expect(heard.find((m) => m.fixture === "i3")?.prevented).toBe(false);
    expect(heard.filter((m) => m.kasten !== undefined)).toEqual([]);
  } finally {
    window.removeEventListener("message", hear);
    popup?.close();
  }
});
