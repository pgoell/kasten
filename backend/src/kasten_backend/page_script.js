// Kasten's half of a page shown in its frame (#785). The backend puts it at
// the start of the page, before any page code, so it runs first. It does
// nothing unless kasten is the parent: a page opened in a tab of its own keeps
// every key.
(() => {
  // Read before any page code runs: a page's own `var parent = ...` replaces
  // `window.parent`, a replaceable attribute, and would cut this script off.
  const up = window.parent;
  if (up === window) return;
  // The same goes for the globals the selection and marks use: a page's own
  // top-level `const Node` or `function getSelection` would shadow them.
  const ELEMENT = Node.ELEMENT_NODE;
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  const getSelection = window.getSelection.bind(window);
  const requestFrame = window.requestAnimationFrame.bind(window);
  const scrollTo = window.scrollTo.bind(window);
  const registry = window.CSS && "highlights" in window.CSS ? window.CSS.highlights : null;

  // A text field keeps its keys, so typing a space or a question mark in a
  // page's own form stays typing.
  const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
  // A control the page presses with a space keeps that space, so Space on it
  // is the page's. `?` and Escape stay kasten's there.
  const PRESSABLE =
    "button, summary, [role='button'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='treeitem'], video, audio";
  // The element the key went to, read off the path: at a window listener, a
  // field inside an open shadow root is reported as its host. A closed root
  // still shows its host, which is as far as this can see.
  const targetOf = (event) => event.composedPath()[0];
  // Not `instanceof Element`, which reads the global `Element`: a page can
  // declare its own, and `closest` is the part this needs anyway.
  const within = (target, selector) =>
    typeof target?.closest === "function" && target.closest(selector) !== null;
  // `y` goes to kasten only over a selection, where it takes the passage. With
  // none it is the page's letter, so a page's own `y` shortcut keeps working.
  const hasSelection = () => {
    const selection = getSelection();
    return !selection.isCollapsed && selection.toString() !== "";
  };

  // Runs in the capture phase on the window, which is the first place a key
  // reaches, so it wins against listeners on the document and on the elements
  // in both phases, and against window listeners in the bubble phase or added
  // after it. This script runs before any page code, so its window capture
  // listener is registered before any the page adds, and a page cannot stop
  // Space on the window before it gets here.
  window.addEventListener(
    "keydown",
    (event) => {
      const target = targetOf(event);
      if (event.ctrlKey || event.altKey || event.metaKey || within(target, TYPING)) return;
      const ours =
        event.key === " "
          ? !event.shiftKey && !within(target, PRESSABLE)
          : event.key === "?" || event.key === "Escape" || (event.key === "y" && hasSelection());
      if (!ours) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      up.postMessage({ kasten: "key", key: event.key }, "*");
    },
    true,
  );

  // Bubble phase, and decided in a task after the dispatch, so a page that
  // handles `j` or `k` and calls preventDefault keeps it and is not scrolled a
  // second time. The script runs before the page's code, so a handler the page
  // adds later runs after this one; the task sees what every handler decided,
  // whatever order they were added in.
  window.addEventListener("keydown", (event) => {
    if (event.shiftKey || event.ctrlKey || event.altKey) return;
    if (event.metaKey || (event.key !== "j" && event.key !== "k")) return;
    if (within(targetOf(event), TYPING)) return;
    window.setTimeout(() => {
      if (!event.defaultPrevented) window.scrollBy({ top: event.key === "j" ? 64 : -64 });
    }, 0);
  });

  // The story a passage sits in: a newspaper article, a section or a card, or the
  // whole page when there is none.
  const CONTAINER = "article, section, [class~='card']";
  const HEADINGS = "h1, h2, h3, h4, h5, h6";
  const MOVES = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  // The last non-empty selection posted, kept as a range so a take can mark it.
  let held = null;

  // Whether `node` is above `start`: it holds the start point, or the start
  // follows it in document order.
  const above = (node, start) =>
    node.contains(start) || (node.compareDocumentPosition(start) & FOLLOWING) !== 0;
  const squash = (text) => text.replace(/\s+/g, " ").trim();
  // Cut by characters, not UTF-16 units, so a surrogate pair is never split.
  const clip = (text, length) => Array.from(text).slice(0, length).join("");

  // A selection takes its heading and story id from where it starts, so one
  // that runs across two articles reads as the first of them.
  const describe = (range, text) => {
    const node = range.startContainer;
    // A range can start at the document itself, which has no parent element.
    const start =
      (node.nodeType === ELEMENT ? node : node.parentElement) ?? document.documentElement;
    const root = start.closest(CONTAINER) ?? document;
    const heading = [...root.querySelectorAll(HEADINGS)].filter((h) => above(h, start)).at(-1);
    // The newspaper prints each story's id as a link, which the page itself
    // carries; an id on the page is the next best answer.
    // Only inside a story: on the whole page the first id printed is another story's.
    const sid =
      root === document
        ? undefined
        : root.querySelector("a.sid")?.getAttribute("href")?.replace(/^#/, "");
    const anchor =
      sid ||
      start.closest("[id]")?.id ||
      [...document.querySelectorAll("[id]")].filter((el) => above(el, start)).at(-1)?.id ||
      "";
    const box = range.getBoundingClientRect();
    return {
      text: clip(text, 10000),
      heading: clip(squash(heading?.textContent ?? ""), 300),
      anchor: clip(anchor, 200),
      rect: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
    };
  };

  // An empty message is how the pane learns the selection went.
  const post = () => {
    const selection = getSelection();
    const text = selection.toString();
    if (text === "") {
      up.postMessage({ kasten: "selection", text: "", heading: "", anchor: "", rect: null }, "*");
      return;
    }
    const range = selection.getRangeAt(0);
    held = range.cloneRange();
    up.postMessage({ kasten: "selection", ...describe(range, text) }, "*");
  };

  // Many events in one frame, such as a drag on a touch screen or a scroll, post
  // once, after the frame, with the selection as it is then.
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestFrame(() => {
      queued = false;
      post();
    });
  };

  window.addEventListener("mouseup", post);
  // Shift with an arrow key or Home or End grows the selection without the mouse,
  // and the keyup is the one event that says it has changed.
  window.addEventListener("keyup", (event) => {
    if (event.shiftKey && MOVES.includes(event.key)) post();
  });
  // A finger moves a touch selection with no mouseup, so it is posted as it
  // changes. Only pointerdown says which device made the selection.
  let touch = false;
  window.addEventListener(
    "pointerdown",
    (event) => {
      touch = event.pointerType === "touch";
    },
    true,
  );
  document.addEventListener("selectionchange", () => {
    if (getSelection().toString() === "") post();
    else if (touch) later();
  });
  // A scroll moves the passage on screen, so the pane gets its new rect. The
  // capture phase catches a scroller inside the page as well as the window.
  window.addEventListener(
    "scroll",
    () => {
      if (held !== null && getSelection().toString() !== "") later();
    },
    true,
  );

  // The page's own scroll, posted once a frame, so a reload of the page after a
  // rewrite puts the reader back where they were (#1277). The window's scroll
  // only: a scroll event on an element does not bubble here, and which of a
  // page's own scrollers the reader meant is not the pane's to guess. Read off
  // the document, since a page's own `var scrollY` replaces the window's.
  let scrollQueued = false;
  window.addEventListener("scroll", () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestFrame(() => {
      scrollQueued = false;
      up.postMessage({ kasten: "scroll", top: document.scrollingElement?.scrollTop ?? 0 }, "*");
    });
  });

  // Marks go into one Highlight and their style into a constructed sheet, so the
  // page's markup is never touched. `taken` maps each take's id to its range, so
  // an untake removes its own mark and not the newest one.
  const MARK = "kasten-taken";
  const MARK_STYLE = `::highlight(${MARK}) { background-color: var(--k-mark, rgba(249,157,27,.22)); text-decoration: underline; text-decoration-thickness: 1px; text-decoration-color: var(--k-accent, currentColor); }`;
  let highlight = null;
  const taken = new Map();
  const take = (id) => {
    if (typeof id !== "number" || held === null || registry === null || taken.has(id)) return;
    if (highlight === null) {
      highlight = new window.Highlight();
      registry.set(MARK, highlight);
      const sheet = new window.CSSStyleSheet();
      sheet.replaceSync(MARK_STYLE);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    // A copy of the range, so the same passage taken twice is two marks and
    // untake removes one of them.
    const mark = held.cloneRange();
    highlight.add(mark);
    taken.set(id, mark);
    // The selection painted over the new mark until a click elsewhere, so it is
    // cleared as the book clears its own. The empty selection it causes posts the pane's clear.
    getSelection().removeAllRanges();
  };
  const untake = (id) => {
    const mark = taken.get(id);
    if (mark === undefined) return;
    highlight.delete(mark);
    taken.delete(id);
  };

  // Each newspaper story gets a Share later button beside its printed id. It sits
  // in a shadow root, so the page's styles do not reach its insides and a
  // selection or the page's text never takes in its label. The root is open so
  // the key listener's path reaches the button and Space presses it. Closing it
  // would keep nothing from the page, which can post a share of its own anyway.
  // The story's source
  // is the link the paper marks `a.src`, or else the first link in the story
  // that leaves the page's own host.
  const SHARE = "Share later";
  const SAVED = "Saved to share";
  const SHARE_STYLE = `button { font: 11px/1.4 system-ui, sans-serif; color: var(--k-muted, #6b6b66); background: transparent; border: 1px solid var(--k-rule, #d8d8d2); border-radius: 4px; padding: 1px 6px; margin-inline-start: 8px; cursor: pointer; vertical-align: middle; } button:hover, button:focus-visible { color: var(--k-accent, currentColor); } button:disabled { cursor: default; color: var(--k-accent, currentColor); } @media (pointer: coarse) { button { min-height: 32px; padding: 4px 10px; } }`;
  const buttons = new Map();
  const sourceOf = (story) => {
    const marked = story.querySelector("a.src[href]");
    if (marked) return marked.href;
    const home = window.location.host;
    for (const link of story.querySelectorAll("a[href]")) {
      if (/^https?:$/.test(link.protocol) && link.host !== home) return link.href;
    }
    return "";
  };
  const addShareButtons = () => {
    for (const story of document.querySelectorAll("article")) {
      const sid = story.querySelector("a.sid");
      const anchor = sid?.getAttribute("href")?.replace(/^#/, "") ?? "";
      if (anchor === "" || buttons.has(anchor)) continue;
      const host = document.createElement("span");
      const root = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = SHARE_STYLE;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = SHARE;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const heading = story.querySelector(HEADINGS);
        up.postMessage(
          {
            kasten: "share",
            heading: clip(squash(heading?.textContent ?? ""), 300),
            anchor: clip(anchor, 200),
            source: clip(sourceOf(story), 2000),
          },
          "*",
        );
      });
      root.append(style, button);
      sid.after(host);
      buttons.set(anchor, button);
    }
  };
  // The script runs before the page is parsed, so the stories are there only later.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addShareButtons);
  } else addShareButtons();
  const markShared = (anchor, saved) => {
    const button = buttons.get(anchor);
    if (button === undefined) return;
    button.textContent = saved ? SAVED : SHARE;
    button.disabled = saved;
  };

  // A page that opts in takes the theme and the palette from kasten. An answer
  // that lands before the meta is parsed is dropped: the backend already wrote
  // both into `<html>` at serve time, and the pane posts again on the frame's
  // load, so nothing is lost.
  const THEMES = ["light", "dark"];
  const PALETTES = ["poel", "russet", "peach", "pansy"];
  // The backend's test for the opt-in, so both agree: name and content trimmed
  // and lowercased, and a meta inside a noscript does not count.
  const optedIn = () =>
    [...document.querySelectorAll("meta")].some(
      (meta) =>
        meta.closest("noscript") === null &&
        (meta.getAttribute("name") ?? "").trim().toLowerCase() === "kasten-theme" &&
        (meta.getAttribute("content") ?? "").trim().toLowerCase() === "tokens",
    );
  // What every page answers, opted in or not: marks, share buttons and the
  // page's words for RSVP. A Map and not an object, so a `kasten` of
  // "constructor" finds nothing.
  const EVERY_PAGE = new Map([
    ["take", (data) => take(data.id)],
    ["untake", (data) => untake(data.id)],
    ["shared", (data) => markShared(data.anchor, true)],
    ["unshared", (data) => markShared(data.anchor, false)],
    // Instant, so a page that scrolls smoothly does not glide from its top.
    [
      "scroll",
      (data) => {
        if (typeof data.top === "number") scrollTo({ top: data.top, behavior: "instant" });
      },
    ],
    // innerText and not textContent: it ends each block with a line break and
    // leaves out what the page hides, which is the page as it reads.
    [
      "text",
      () =>
        up.postMessage({ kasten: "text", text: document.body ? document.body.innerText : "" }, "*"),
    ],
  ]);
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== up || typeof data !== "object" || data === null) return;
    const answer = EVERY_PAGE.get(data.kasten);
    if (answer !== undefined) return answer(data);
    if (!optedIn()) return;
    if (data.kasten === "theme" && THEMES.includes(data.theme)) {
      document.documentElement.setAttribute("data-theme", data.theme);
    } else if (data.kasten === "palette" && PALETTES.includes(data.palette)) {
      document.documentElement.setAttribute("data-palette", data.palette);
    }
  });

  up.postMessage({ kasten: "hello" }, "*");
})();
