import "@fontsource-variable/instrument-sans/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ListsApp } from "./lists-app";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

// The lists page has no switch of its own: it follows the phone's scheme and
// sets data-theme before the first paint. It does not read the main app's stored
// choice, which lives under another origin's storage and is not this page's to read.
const DARK = matchMedia("(prefers-color-scheme: dark)");
function paintTheme(): void {
  const root = document.documentElement;
  root.dataset.theme = DARK.matches ? "dark" : "light";
  const page = getComputedStyle(root).getPropertyValue("--k-bg").trim();
  // The browser bar takes the page colour, whichever scheme is showing.
  if (page) {
    for (const bar of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      bar.content = page;
    }
  }
}
paintTheme();
DARK.addEventListener("change", paintTheme);

// Production only. In development a worker would keep serving the shell that
// the reload has just changed.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/lists-sw.js");
  });
}

createRoot(rootElement).render(
  <StrictMode>
    <ListsApp />
  </StrictMode>,
);
