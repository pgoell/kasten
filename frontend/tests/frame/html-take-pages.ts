/**
 * The pages the take tests serve (#787): a newspaper with two stories, a page with
 * only element ids, and a hostile page with a nested frame and a window of its own.
 *
 * Every page but the window carries the same reporter. It answers the test's
 * probes from inside the frame, since the frame's DOM is out of reach: it makes a
 * selection the way a mouse or a finger does, and reads back the marks, the
 * selection and the theme. It hears the parent only.
 */

const REPORTER = `<script>
addEventListener("message", (event) => {
  const data = event.data ?? {};
  if (event.source !== parent || typeof data.probe !== "string") return;
  const reply = (fixture, extra = {}) => parent.postMessage({ fixture, ...extra }, "*");
  const select = ([from, fromAt, to, toAt]) => {
    const range = document.createRange();
    range.setStart(document.getElementById(from).firstChild, fromAt);
    range.setEnd(document.getElementById(to).firstChild, toAt);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  };
  if (data.probe === "select") {
    select(data.range);
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    reply("selected");
  }
  if (data.probe === "touchSelect") {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
    select(data.range);
    reply("selected");
  }
  if (data.probe === "selection") {
    const range = getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
    const box = range?.getBoundingClientRect();
    const rect = box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null;
    reply("selection", { text: getSelection().toString(), rect });
  }
  if (data.probe === "marks") {
    const highlight = CSS.highlights.get("kasten-taken");
    reply("marks", { texts: highlight ? [...highlight].map((range) => range.toString()) : [] });
  }
  if (data.probe === "look") reply("look", { theme: document.documentElement.getAttribute("data-theme") });
  if (data.probe === "scroll") {
    scrollBy(0, data.by);
    reply("scroll", { y: scrollY });
  }
  if (data.probe === "fake") {
    parent.postMessage({ kasten: "selection", text: "Fake words", heading: "Fake", anchor: "fake", rect: { left: 100, top: 100, right: 200, bottom: 120 } }, "*");
    reply("faked");
  }
});
</script>`;

/** A page with the reporter at its end, and `head` in its head, for a test to serve. */
export function page(title: string, body: string, head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}${REPORTER}</body></html>`;
}

/** The two stories, as the newspaper prints them: each story's id is a link in its article. */
const STORIES = `<article id="2026-10-07-evals-01"><a class="sid" href="#2026-10-07-evals-01">#2026-10-07-evals-01</a><h2>First story</h2><p id="p1" data-testid="p1">Alpha bravo charlie delta echo foxtrot golf hotel.</p><p>India juliet kilo lima mike november oscar papa.</p><p>Quebec romeo sierra tango uniform victor whiskey xray.</p></article><article id="2026-10-07-evals-02"><a class="sid" href="#2026-10-07-evals-02">#2026-10-07-evals-02</a><h2>Second story</h2><p id="p2" data-testid="p2">Yankee zulu one two three four five six.</p><p>Seven eight nine ten eleven twelve.</p><p>Thirteen fourteen fifteen sixteen seventeen.</p></article><div style="height:1600px"></div>`;

/** A newspaper that opts in to the app's theme, and is tall enough to scroll. */
export const NEWS = page(
  "Evals",
  `<main style="font:16px/1.6 Georgia,serif;padding:24px 32px">${STORIES}</main>`,
  '<meta name="kasten-theme" content="tokens">',
);

/** A page with only element ids: no article, no heading. */
export const PLAIN = page(
  "Plain notes",
  `<div id="top"><p id="line">Alpha bravo charlie.</p></div><div style="height:1600px"></div>`,
);

/** A window the hostile page opens. It posts a selection and a `y` to the page's parent, the app. */
export const POPUP = `<!doctype html><title>popup</title><body><script>
const target = window.opener;
target?.parent.postMessage({ kasten: "selection", text: "Popup words", heading: "Popup", anchor: "popup", rect: { left: 100, top: 100, right: 200, bottom: 120 } }, "*");
target?.parent.postMessage({ kasten: "key", key: "y" }, "*");
target?.parent.postMessage({ fixture: "popup" }, "*");
</script></body>`;

/**
 * The newspaper, with a nested frame that posts a selection and a `y` to the app
 * and a button that opens `POPUP`. The `nest` probe asks the nested frame to post.
 */
export const HOSTILE = page(
  "Hostile",
  `<main style="font:16px/1.6 Georgia,serif;padding:24px 32px">${STORIES}</main>
<iframe id="nested" style="position:absolute;left:0;top:0;width:10px;height:10px;border:0" srcdoc="<script>addEventListener('message', () => { parent.parent.postMessage({ kasten: 'selection', text: 'Nested words', heading: 'Nested', anchor: 'nested', rect: { left: 100, top: 100, right: 200, bottom: 120 } }, '*'); parent.postMessage({ kasten: 'take', id: 1 }, '*'); parent.parent.postMessage({ kasten: 'key', key: 'y' }, '*'); parent.parent.postMessage({ fixture: 'nested' }, '*'); });</script>"></iframe>
<button type="button" onclick="window.open('take-popup.html')" style="position:fixed;left:0;top:0;width:180px;height:44px">Open a window</button>
<script>
addEventListener("message", (event) => {
  if (event.source === parent && event.data?.probe === "nest") document.getElementById("nested").contentWindow.postMessage("fire", "*");
});
</script>`,
);
