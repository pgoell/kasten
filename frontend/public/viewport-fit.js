// Takes `viewport-fit=cover` back off the viewport meta on Android (#364).
//
// Safari needs it to answer env(safe-area-inset-*) at all (#355). Chrome on
// Android reads it as a request to draw edge to edge under the system bars,
// where its dvh and inset numbers do not add up the way Safari's do: on an
// installed app with three-button navigation the page scrolled and the bottom
// bar sat under the buttons. Without cover every inset there is zero, so the
// safe-frame padding does nothing and Android lays out as before #355.
//
// A classic script in public/ rather than a module in src/: it has to run
// before the first layout, and a module runs only after the document parses.
// The policy is `script-src 'self'`, which rules out an inline script.
if (navigator.userAgent.includes("Android")) {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    meta.content = meta.content
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "viewport-fit=cover")
      .join(", ");
  }
}
