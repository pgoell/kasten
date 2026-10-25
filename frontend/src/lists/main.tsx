import "@fontsource-variable/instrument-sans/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { followScheme } from "./follow-scheme";
import { ListsApp } from "./lists-app";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

// Called here before the first render so the theme is set before the first paint;
// ListsApp follows it again once it mounts.
followScheme();

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
