import { useQuery } from "@tanstack/react-query";
import { fetchLayout } from "@/lib/core/api";
import { SCREENS } from "@/lib/ui/keys/key-bindings";

/**
 * The one query for the layout, which the root route asks once a page. `fetchLayout` is reached
 * inside the call, so a test that mocks the api module without it fails this query, not the page.
 */
export const layoutQuery = {
  queryKey: ["layout"],
  queryFn: () => fetchLayout(),
  staleTime: Number.POSITIVE_INFINITY,
};

/** The pages beside the notes: the screens the key help lists, each named by its address. */
const PAGES = SCREENS.map(({ key }) => ({ href: key, label: key.slice(1) }));

const LINK =
  "text-k-13 text-k-muted underline-offset-2 hover:text-k-accent hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center";

/**
 * The row atop a page of its own: back to the notes, and across to the other pages.
 * An installed app has no address bar, so this row is the only way off the page there.
 * Plain links, not the router's: the notes route wants a whole page load.
 */
export function PageNav({ here, className = "" }: { here: string; className?: string }) {
  // The root route asked already; this reads its answer for the lists app's address.
  const layout = useQuery(layoutQuery);
  const lists = layout.data?.lists;

  return (
    <nav aria-label="Pages" className={`flex flex-wrap items-center gap-x-4 ${className}`}>
      <a href="/" className={`${LINK} mr-auto`}>
        ← notes
      </a>
      {PAGES.map(({ href, label }) =>
        href === here ? (
          <span
            key={href}
            aria-current="page"
            className="text-k-13 text-k-ink pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
          >
            {label}
          </span>
        ) : (
          <a key={href} href={href} className={LINK}>
            {label}
          </a>
        ),
      )}
      {lists && (
        <a href={lists} className={LINK}>
          lists
        </a>
      )}
    </nav>
  );
}
