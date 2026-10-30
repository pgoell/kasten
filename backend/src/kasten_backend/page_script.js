// Kasten's half of a page shown in its frame (#785), run before any page code.
// It does nothing unless kasten is the parent.
(() => {
  // Read before any page code runs: a page's own `var parent = ...` replaces
  // `window.parent`, a replaceable attribute, and would cut this script off.
  const up = window.parent;
  if (up === window) return;
  // Likewise a page's own `const Node` or `function getSelection` would shadow these.
  const ELEMENT = Node.ELEMENT_NODE;
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  const getSelection = window.getSelection.bind(window);
  const requestFrame = window.requestAnimationFrame.bind(window);
  const scrollTo = window.scrollTo.bind(window);
  const setTimer = window.setTimeout.bind(window);
  const clearTimer = window.clearTimeout.bind(window);
  const Observer = window.ResizeObserver;
  const registry = window.CSS && "highlights" in window.CSS ? window.CSS.highlights : null;

  // A text field keeps its keys.
  const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
  // A control the page presses with Space keeps it; `?` and Escape stay kasten's.
  const PRESSABLE =
    "button, summary, [role='button'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='treeitem'], video, audio";
  // Read off the path: at a window listener, a field in an open shadow root
  // reports as its host.
  const targetOf = (event) => event.composedPath()[0];
  // Not `instanceof Element`, which reads the global `Element`: a page can
  // declare its own, and `closest` is the part this needs anyway.
  const within = (target, selector) =>
    typeof target?.closest === "function" && target.closest(selector) !== null;
  // `y` goes to kasten only over a selection; with none it is the page's letter.
  const hasSelection = () => {
    const selection = getSelection();
    return !selection.isCollapsed && selection.toString() !== "";
  };

  // Window capture phase, registered before any page code, so no page listener
  // sees these keys first.
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

  // Decided in a task after the dispatch, so a page that handles `j` or `k` and
  // calls preventDefault is not scrolled a second time.
  window.addEventListener("keydown", (event) => {
    if (event.shiftKey || event.ctrlKey || event.altKey) return;
    if (event.metaKey || (event.key !== "j" && event.key !== "k")) return;
    if (within(targetOf(event), TYPING)) return;
    window.setTimeout(() => {
      if (!event.defaultPrevented) window.scrollBy({ top: event.key === "j" ? 64 : -64 });
    }, 0);
  });

  // The story a passage sits in; the whole page when there is none.
  const CONTAINER = "article, section, [class~='card']";
  const HEADINGS = "h1, h2, h3, h4, h5, h6";
  const MOVES = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  // The last non-empty selection posted, kept as a range so a take can mark it.
  let held = null;

  // `node` holds `start` or comes before it in document order.
  const above = (node, start) =>
    node.contains(start) || (node.compareDocumentPosition(start) & FOLLOWING) !== 0;
  const squash = (text) => text.replace(/\s+/g, " ").trim();
  // Cut by characters, not UTF-16 units, so a surrogate pair is never split.
  const clip = (text, length) => Array.from(text).slice(0, length).join("");

  // A selection across two articles reads as the one it starts in.
  const describe = (range, text) => {
    const node = range.startContainer;
    // A range can start at the document itself, which has no parent element.
    const start =
      (node.nodeType === ELEMENT ? node : node.parentElement) ?? document.documentElement;
    const root = start.closest(CONTAINER) ?? document;
    const heading = [...root.querySelectorAll(HEADINGS)].filter((h) => above(h, start)).at(-1);
    // The newspaper's story-id link, only inside a story: on the whole page the
    // first one printed is another story's.
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

  // Many events in one frame post once, after it.
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
  // A keyboard-grown selection says it changed only on keyup.
  window.addEventListener("keyup", (event) => {
    if (event.shiftKey && MOVES.includes(event.key)) post();
  });
  // A touch selection has no mouseup; only pointerdown says it was touch.
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
  // Capture phase, so a scroller inside the page moves the rect too.
  window.addEventListener(
    "scroll",
    () => {
      if (held !== null && getSelection().toString() !== "") later();
    },
    true,
  );

  // The window's scroll, kept across a reload (#1277). A restored scroll is held
  // until the page grows tall enough, the reader touches it, or HOLD (#1280).
  const HOLD = 1500;
  const position = () => document.scrollingElement?.scrollTop ?? 0;
  let target = null;
  let holding = 0;
  const settle = () => {
    if (target === null) return;
    scrollTo({ top: target, behavior: "instant" });
    if (Math.abs(position() - target) < 1) target = null;
  };
  const letGo = () => {
    if (target === null) return;
    target = null;
    up.postMessage({ kasten: "scroll", top: position() }, "*");
  };
  // A page whose html box is the window's height grows in its body.
  if (typeof Observer === "function") {
    const watch = new Observer(settle);
    watch.observe(document.documentElement);
    const watchBody = () => document.body && watch.observe(document.body);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", watchBody);
    } else watchBody();
  }
  // An input that does not scroll still reports the position (#1282).
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    window.addEventListener(type, letGo, { capture: true, passive: true });
  }
  let scrollQueued = false;
  window.addEventListener("scroll", () => {
    if (scrollQueued) return;
    scrollQueued = true;
    requestFrame(() => {
      scrollQueued = false;
      if (target === null) up.postMessage({ kasten: "scroll", top: position() }, "*");
    });
  });

  // A Highlight and a constructed sheet leave the page's markup untouched.
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
    // A copy, so the same passage taken twice is two marks.
    const mark = held.cloneRange();
    highlight.add(mark);
    taken.set(id, mark);
    // The selection would paint over the new mark.
    getSelection().removeAllRanges();
  };
  const untake = (id) => {
    const mark = taken.get(id);
    if (mark === undefined) return;
    highlight.delete(mark);
    taken.delete(id);
  };

  // A shadow root keeps page styles and selections off the button; it is open so
  // Space reaches it.
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
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addShareButtons);
  } else addShareButtons();
  const markShared = (anchor, saved) => {
    const button = buttons.get(anchor);
    if (button === undefined) return;
    button.textContent = saved ? SAVED : SHARE;
    button.disabled = saved;
  };

  // An answer before the meta is parsed is dropped; the pane posts again on load.
  const THEMES = ["light", "dark"];
  const PALETTES = ["poel", "russet", "peach", "pansy"];
  // Matches the backend's opt-in test.
  const optedIn = () =>
    [...document.querySelectorAll("meta")].some(
      (meta) =>
        meta.closest("noscript") === null &&
        (meta.getAttribute("name") ?? "").trim().toLowerCase() === "kasten-theme" &&
        (meta.getAttribute("content") ?? "").trim().toLowerCase() === "tokens",
    );
  // A Map, so a `kasten` of "constructor" finds nothing.
  const EVERY_PAGE = new Map([
    ["take", (data) => take(data.id)],
    ["untake", (data) => untake(data.id)],
    ["shared", (data) => markShared(data.anchor, true)],
    ["unshared", (data) => markShared(data.anchor, false)],
    // Instant, so a page that scrolls smoothly does not glide from its top.
    [
      "scroll",
      (data) => {
        if (typeof data.top !== "number") return;
        target = data.top;
        settle();
        clearTimer(holding);
        holding = setTimer(letGo, HOLD);
      },
    ],
    // innerText leaves out what the page hides.
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
