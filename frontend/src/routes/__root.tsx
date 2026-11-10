import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { layoutQuery } from "./-pages";

export const Route = createRootRoute({
  component: Root,
});

/**
 * Every page, under one request for the vault's folders. Asked without waiting:
 * `layout.ts` starts on the defaults until the answer comes.
 */
function Root() {
  useQuery(layoutQuery);
  return <Outlet />;
}
