import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { forgetSpentReloads, RouteError } from "./lib/chunk-reload";
import { start as startOutbox } from "./lib/outbox";
import "./lib/service-worker";
import { startTheme } from "@/lib/theme";
import { routeTree } from "./routeTree.gen";
import "./styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

// The entry chunk's hashed URL, which names the release: any chunk that
// changes renames every chunk importing it, up to this one. Before the router,
// so a route's lazy chunk finds its reload guard already reset.
forgetSpentReloads(import.meta.url);

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: "intent",
  defaultErrorComponent: RouteError,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

// Dumps kept while offline go now, and whenever the signal returns, on any page.
startOutbox();

// The early script in public/theme.js has set data-theme already. This adds the
// browser bar's colour and the listeners for the system and other tabs.
startTheme();

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
