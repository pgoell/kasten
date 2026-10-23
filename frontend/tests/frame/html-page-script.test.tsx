/**
 * The page script inside a real frame, with no pane around it (#785).
 *
 * The frame is sandboxed the way `html-pane.tsx` sandboxes one, and each page
 * comes from `servePage`, which appends the script the way `read_html` does.
 * The keys are real ones pressed in Chromium, since a frame's key handling is
 * what jsdom cannot show.
 */

import { commands, userEvent } from "vitest/browser";
import {
  atStart,
  cleanup,
  FIELD_STYLE,
  field,
  keysSent,
  type Message,
  messages,
  mount,
  PAGE,
  pageState,
  REPORT,
  reported,
  scrollY,
  sendToPage,
} from "./page-script-harness";

afterEach(cleanup);

/** Tall enough to scroll, and nothing else, so a key that scrolls moves `scrollY`. */
const TALL = `<!doctype html><title>tall</title><body><div style="height:3000px"></div>${REPORT}</body>`;

/** A page that handles `j` itself and says so. */
const OWN_J = `<!doctype html><title>own j</title><body><div style="height:3000px"></div>${REPORT}<script>
addEventListener("keydown", (event) => {
  if (event.key === "j") {
    event.preventDefault();
    parent.postMessage({ fixture: "own-j" }, "*");
    setTimeout(() => parent.postMessage({ fixture: "after-j", y: scrollY }, "*"), 0);
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

/** A page whose own top-level names shadow `parent` and `Element`, which the script must not read through. */
const SHADOWED = `<!doctype html><title>shadowed</title><body><div style="height:3000px"></div><script>const parent = document.body; const Element = null;</script></body>`;

/** A button the page presses, and reports the press. */
const BUTTON = `<!doctype html><title>button</title><body><button id="press" style="margin:200px">press</button><script>
document.getElementById("press").addEventListener("click", () => parent.postMessage({ fixture: "pressed" }, "*"));
</script>${REPORT}</body>`;

/** A field inside a shadow root, where a window listener sees the host as the target. */
const SHADOW_FIELD = `<!doctype html><title>shadow</title><body><div id="host"></div><div style="height:3000px"></div>${REPORT}<script>
const root = document.getElementById("host").attachShadow({ mode: "open" });
root.innerHTML = '<input id="field" style="${FIELD_STYLE}">';
const field = root.getElementById("field");
field.addEventListener("input", () => parent.postMessage({ fixture: "value", value: field.value }, "*"));
</script></body>`;

/** A page that catches Space on the document in the capture phase, which runs after the window's. */
const DOC_CAPTURE = `<!doctype html><title>doc</title><body><div style="height:3000px"></div><script>
document.addEventListener("keydown", (event) => { if (event.key === " ") parent.postMessage({ fixture: "caught" }, "*"); }, true);
</script>${REPORT}</body>`;

/**
 * A page that answers `state` with its theme, palette, open details, scroll and a
 * value its own script set, so a test can see which of them a message changed. It
 * reports a message that did not come from its parent, which is how a test knows a
 * nested frame's message arrived.
 */
const STATE = `<div style="height:3000px"></div><details open><summary>more</summary>text</details><script>
window.marker = "set";
addEventListener("message", (event) => {
  if (event.data === "half") scrollTo(0, 1000);
  if (event.data === "state") {
    const html = document.documentElement;
    parent.postMessage({ fixture: "state", theme: html.dataset.theme, palette: html.dataset.palette, open: document.querySelector("details").open, marker: window.marker, y: scrollY }, "*");
  }
  if (event.source !== parent) parent.postMessage({ fixture: "heard" }, "*");
});
</script>`;

/** A page that opts in to the tokens, so kasten's theme and palette reach it. */
const OPTED_IN = `<meta name="kasten-theme" content="tokens">${STATE}`;

/** The page a link inside the frame goes to, and what it reports on arriving. */
const OTHER = "other.html";
const ARRIVED = `${OPTED_IN}<script>parent.postMessage({ fixture: "arrived", search: location.search, theme: document.documentElement.dataset.theme }, "*");</script>`;

/** A page with a link to `OTHER`, which its own script clicks when the test says "click". */
const LINKING = `<a id="go" href="${OTHER}">go</a>${OPTED_IN}<script>
addEventListener("message", (event) => { if (event.data === "click") document.getElementById("go").click(); });
</script>`;

/**
 * Type Space, `?`, `j` and `k` into a field, and check the page kept them as
 * letters and kasten got none, and that the page did not scroll. Escape comes
 * last, and it is the barrier: it is the last key the page reports.
 */
async function typeInField(control: string) {
  const element = await mount(field(control));
  await userEvent.click(element);
  await userEvent.keyboard(" ");
  await userEvent.keyboard("?");
  await userEvent.keyboard("j");
  await userEvent.keyboard("k");
  await userEvent.keyboard("{Escape}");

  await expect.poll(() => reported("Escape")).toBe(true);
  const values = messages.filter((m) => m.fixture === "value");
  expect(values.at(-1)?.value).toBe(" ?jk");
  expect(keysSent()).toEqual([]);
  expect(await scrollY()).toBe(0);
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

  // The page's timeout is queued after kasten's, so its answer comes after kasten's scroll would.
  await expect.poll(() => messages.some((m) => m.fixture === "after-j")).toBe(true);
  expect(messages.find((m) => m.fixture === "after-j")?.y).toBe(0);
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

it("a page that declares its own parent still sends hello and Space", async () => {
  const element = await mount(SHADOWED);
  await expect.poll(() => messages).toContainEqual({ kasten: "hello" });

  await userEvent.click(element);
  await userEvent.keyboard(" ");

  await expect.poll(keysSent).toEqual([" "]);
});

it("Space on a button of the page presses it and kasten is not sent it", async () => {
  const element = await mount(BUTTON);
  await userEvent.click(element);
  await userEvent.keyboard("{Tab}");
  await userEvent.keyboard(" ");

  await expect.poll(() => messages.some((m) => m.fixture === "pressed")).toBe(true);
  expect(keysSent()).toEqual([]);

  await userEvent.keyboard("?");
  await expect.poll(keysSent).toEqual(["?"]);
});

it("in a field inside a shadow root, Space, ? and j stay the page's", async () => {
  const element = await mount(SHADOW_FIELD);
  await userEvent.click(element);
  await userEvent.keyboard(" ");
  await userEvent.keyboard("?");
  await userEvent.keyboard("j");
  await userEvent.keyboard("a");

  await expect.poll(() => reported("a")).toBe(true);
  const lastValue = () => messages.filter((m) => m.fixture === "value").at(-1)?.value;
  await expect.poll(lastValue).toBe(" ?ja");
  expect(keysSent()).toEqual([]);
  expect(await scrollY()).toBe(0);
});

it("a page that catches Space on the document in the capture phase does not see it, and kasten still gets it", async () => {
  const element = await mount(DOC_CAPTURE);
  await userEvent.click(element);
  await userEvent.keyboard(" ");
  await userEvent.keyboard("a");

  await expect.poll(() => reported("a")).toBe(true);
  expect(keysSent()).toEqual([" "]);
  expect(messages.some((m) => m.fixture === "caught")).toBe(false);
});

it("a page with its own var parent still sends hello and Space", async () => {
  const element = await mount(
    atStart(`<div style="height:3000px"></div><script>var parent = { postMessage() {} };</script>`),
  );
  await expect.poll(() => messages).toContainEqual({ kasten: "hello" });

  await userEvent.click(element);
  await userEvent.keyboard(" ");

  await expect.poll(keysSent).toEqual([" "]);
});

it("a page's own window capture listener for Space does not keep it from kasten", async () => {
  const element = await mount(
    atStart(`<div style="height:3000px"></div>${REPORT}<script>
addEventListener("keydown", (event) => { if (event.key === " ") event.stopImmediatePropagation(); }, true);
</script>`),
  );
  await userEvent.click(element);
  await userEvent.keyboard(" ");
  await userEvent.keyboard("a");

  await expect.poll(() => reported("a")).toBe(true);
  expect(keysSent()).toEqual([" "]);
});

it("an opted-in page takes the theme and the palette from kasten by message, and keeps its scroll and open details", async () => {
  await mount(atStart(OPTED_IN));
  sendToPage("half");
  const before = await pageState();

  sendToPage({ kasten: "theme", theme: "dark" });
  sendToPage({ kasten: "palette", palette: "pansy" });
  const after = await pageState();

  expect(after?.theme).toBe("dark");
  expect(after?.palette).toBe("pansy");
  expect(before?.y).toBeGreaterThan(0);
  expect(after?.y).toBe(before?.y);
  expect(after?.open).toBe(true);
  expect(after?.marker).toBe("set");
});

it("a plain page ignores a theme message", async () => {
  await mount(atStart(STATE));
  sendToPage({ kasten: "theme", theme: "dark" });

  expect((await pageState())?.theme).toBeUndefined();
});

it("a theme message from another window is ignored", async () => {
  await mount(
    atStart(
      `${OPTED_IN}<iframe srcdoc="<script>parent.postMessage({kasten:'theme',theme:'dark'},'*')</script>"></iframe>`,
    ),
  );
  await expect.poll(() => messages.some((m) => m.fixture === "heard")).toBe(true);

  sendToPage({ kasten: "theme", theme: "light" });

  expect((await pageState())?.theme).toBe("light");
});

it("an unknown theme value is ignored", async () => {
  await mount(atStart(OPTED_IN));
  sendToPage({ kasten: "theme", theme: "sepia" });
  expect((await pageState())?.theme).toBeUndefined();

  sendToPage({ kasten: "theme", theme: "light" });
  expect((await pageState())?.theme).toBe("light");
});

it("an opted-in page whose meta has spaces round its value still follows a switch", async () => {
  await mount(
    atStart(`<meta name="kasten-theme" content=" tokens ">${STATE}`),
    "?theme=light&palette=poel",
  );
  // The backend opted the page in, so the theme it was served with is on `<html>`.
  expect((await pageState())?.theme).toBe("light");

  sendToPage({ kasten: "theme", theme: "dark" });
  expect((await pageState())?.theme).toBe("dark");
});

it("a link to another vault page inside the frame keeps the theme query", async () => {
  await commands.servePage(OTHER, atStart(ARRIVED));
  await mount(atStart(LINKING), "?theme=dark&palette=pansy");

  sendToPage("click");

  await expect.poll(() => messages.some((m) => m.fixture === "arrived")).toBe(true);
  const arrived = messages.find((m) => m.fixture === "arrived");
  expect(arrived?.search).toBe("?theme=dark&palette=pansy");
  expect(arrived?.theme).toBe("dark");
});
