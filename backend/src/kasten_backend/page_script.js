// Kasten's half of a page shown in its frame (#785). The backend appends it
// after the page, so it runs at the end of `<body>`. It does nothing unless
// kasten is the parent: a page opened in a tab of its own keeps every key.
(() => {
  if (window.parent === window) return;

  // A text field keeps its keys, so typing a space or a question mark in a
  // page's own form stays typing.
  const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
  const isTyping = (target) => target instanceof Element && target.closest(TYPING) !== null;

  // Runs in the capture phase and stops the event there, so a page that
  // catches Space or `?` itself never sees it: kasten owns those keys.
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.ctrlKey || event.altKey || event.metaKey || isTyping(event.target)) return;
      const ours =
        event.key === " " ? !event.shiftKey : event.key === "?" || event.key === "Escape";
      if (!ours) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      parent.postMessage({ kasten: "key", key: event.key }, "*");
    },
    true,
  );

  // Bubble phase, so a page that handles `j` or `k` and calls preventDefault
  // keeps it and is not scrolled a second time.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.shiftKey || event.ctrlKey || event.altKey) return;
    if (event.metaKey || (event.key !== "j" && event.key !== "k")) return;
    if (isTyping(event.target)) return;
    event.preventDefault();
    window.scrollBy({ top: event.key === "j" ? 64 : -64 });
  });

  parent.postMessage({ kasten: "hello" }, "*");
})();
