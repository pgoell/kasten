import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { fetchLayout } from "@/lib/api";

export const Route = createRootRoute({
  component: Root,
});

/**
 * Every page, under one request for the vault's folders. Asked without waiting:
 * `layout.ts` starts on the defaults until the answer comes.
 */
function Root() {
  useQuery({
    queryKey: ["layout"],
    // Reached inside the call rather than at render, so an api module without
    // it, which is what most route tests mock, fails this query and not the page.
    queryFn: () => fetchLayout(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return <Outlet />;
}
