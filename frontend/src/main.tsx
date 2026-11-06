import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { forgetSpentReloads, RouteError } from "@/lib/app/chunk-reload";
import { start as startOutbox } from "@/lib/capture/outbox";
import "@/lib/app/service-worker";
import { checkSession, startSessionCheck } from "@/lib/app/session";
import { startPress } from "@/lib/ui/input/press";
import { startTheme } from "@/lib/ui/theme";
import { routeTree } from "./routeTree.gen";
import "./styles/app.css";

// Any failed call may be a session the gate has dropped; the probe tells that from a real error.
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: () => void checkSession() }),
  mutationCache: new MutationCache({ onError: () => void checkSession() }),
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

// A session that ran out while the page sat open sends it to sign in, rather than failing quietly.
startSessionCheck();

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

// Press feedback is one listener on the document, so it starts once, here.
startPress();

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
