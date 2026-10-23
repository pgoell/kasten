// Kasten's half of a page shown in its frame (#785). The backend appends it
// after the page, so it runs at the end of `<body>`. It does nothing unless
// kasten is the parent: a page opened in a tab of its own keeps every key.
(() => {
  if (window.parent === window) return;

  // A text field keeps its keys, so typing a space or a question mark in a
  // page's own form stays typing.
  const TYPING = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
  // A button or a control the page presses with a space keeps that space, so
  // Space on it is the page's. `?` and Escape stay kasten's there.
  const PRESSABLE =
    "button, summary, [role='button'], [role='checkbox'], [role='switch'], [role='tab'], [role='menuitem'], [role='option'], video, audio";
  // The element the key went to, read off the path: at a window listener, a
  // field inside a shadow root is reported as its host.
  const targetOf = (event) => event.composedPath()[0];
  // Not `instanceof Element`, which reads the global `Element`: a page can
  // declare its own, and `closest` is the part this needs anyway.
  const within = (target, selector) =>
    typeof target?.closest === "function" && target.closest(selector) !== null;

  // Runs in the capture phase on the window, which is the first place a key
  // reaches. So it wins against every listener on the document and on the
  // elements, in both phases, and against window listeners in the bubble
  // phase or added after it. It cannot win against a window capture listener
  // the page added before this one: that runs first and may stop the key.
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
      window.parent.postMessage({ kasten: "key", key: event.key }, "*");
    },
    true,
  );

  // Bubble phase, so a page that handles `j` or `k` and calls preventDefault
  // keeps it and is not scrolled a second time.
  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.shiftKey || event.ctrlKey || event.altKey) return;
    if (event.metaKey || (event.key !== "j" && event.key !== "k")) return;
    if (within(targetOf(event), TYPING)) return;
    event.preventDefault();
    window.scrollBy({ top: event.key === "j" ? 64 : -64 });
  });

  window.parent.postMessage({ kasten: "hello" }, "*");
})();
