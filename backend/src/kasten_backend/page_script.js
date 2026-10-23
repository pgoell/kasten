// Kasten's half of a page shown in its frame (#785). The backend puts it at
// the start of the page, before any page code, so it runs first. It does
// nothing unless kasten is the parent: a page opened in a tab of its own keeps
// every key.
(() => {
  // Read before any page code runs: a page's own `var parent = …` replaces
  // `window.parent`, a replaceable attribute, and would cut this script off.
  const up = window.parent;
  if (up === window) return;

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
          : event.key === "?" || event.key === "Escape";
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
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== up || typeof data !== "object" || data === null) return;
    if (!optedIn()) return;
    if (data.kasten === "theme" && THEMES.includes(data.theme)) {
      document.documentElement.setAttribute("data-theme", data.theme);
    } else if (data.kasten === "palette" && PALETTES.includes(data.palette)) {
      document.documentElement.setAttribute("data-palette", data.palette);
    }
  });

  up.postMessage({ kasten: "hello" }, "*");
})();
