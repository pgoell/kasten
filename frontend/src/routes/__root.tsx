import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { fetchLayout } from "@/lib/api";
import { applyInstall } from "@/lib/install";

export const Route = createRootRoute({
  component: Root,
});

/**
 * Every page, under one request for the vault's folders.
 *
 * Asked here and not waited for: `layout.ts` starts on the defaults, so a vault
 * on the default layout renders exactly as it would without the answer, and
 * one with its own folders has them before anyone can press a key that files.
 */
function Root() {
  useQuery({
    queryKey: ["layout"],
    // Reached inside the call rather than at render, so an api module without
    // it, which is what most route tests mock, fails this query and not the page.
    queryFn: () => fetchLayout(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Here rather than in the capture route, so leaving `/capture` without a
  // reload hands the tags back to the notebook.
  const pathname = useLocation({ select: (location) => location.pathname });
  useEffect(() => applyInstall(pathname), [pathname]);

  return <Outlet />;
}
