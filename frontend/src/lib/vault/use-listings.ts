import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useVersion } from "@/lib/app/build";
import {
  fetchAssets,
  fetchFiles,
  fetchHtml,
  fetchImages,
  fetchNote,
  fetchTags,
} from "@/lib/core/api";
import { ONTOLOGY_NOTE, relationNames } from "@/lib/notes/links/ontology";
import { visible } from "@/lib/search/archive";
import type { TreeCommands } from "@/lib/ui/keys/key-bindings";
import { isTreeFile } from "@/lib/vault/file-kind";

/** What a list prop gets while its query loads: one array, so the memo built over it holds. */
const LOADING: string[] = [];

export type Listings = ReturnType<typeof useListings>;

const FILES = { queryKey: ["files"], queryFn: fetchFiles };
const HTML = { queryKey: ["html"], queryFn: fetchHtml };
const ASSETS = { queryKey: ["assets"], queryFn: fetchAssets };

/** Every path a `[[link]]` can land on, by kind. */
export type LinkPaths = { files: string[]; html: string[]; assets: string[] };

/**
 * The listings as the cache holds them at a key press, not as the last render saw them, waiting for any
 * still on its way. A key queued behind a render reaches a handler built before it (#2032).
 */
export function linkPaths(queryClient: QueryClient): LinkPaths | Promise<LinkPaths> {
  const files = queryClient.getQueryData<string[]>(FILES.queryKey);
  const html = queryClient.getQueryData<string[]>(HTML.queryKey);
  const assets = queryClient.getQueryData<string[]>(ASSETS.queryKey);
  if (files && html && assets) return { files, html, assets };
  return Promise.all([
    queryClient.ensureQueryData(FILES),
    queryClient.ensureQueryData(HTML),
    queryClient.ensureQueryData(ASSETS),
  ]).then(([files, html, assets]) => ({ files, html, assets }));
}

/** Every listing the route draws from, with the archive filter applied, and the toggle for it. */
export function useListings() {
  const { data } = useQuery(FILES);
  const version = useVersion();
  // Beside the notes, not in them: images are tree rows, and `![](` completes to their paths.
  // A `listing` event refetches them, since it fires for any change that is not a note.
  const { data: images } = useQuery({ queryKey: ["images"], queryFn: fetchImages });
  // HTML pages a research run leaves: tree rows only. Refetched on a `listing` like the images.
  const { data: html } = useQuery(HTML);
  // Books, pdfs and pictures, which `[[plan.pdf]]` links name. Refetched on a `listing` too.
  const { data: assets } = useQuery(ASSETS);
  // What a `[[link]]` can land on. Absent while the notes load, so no link reads as dead early.
  const linkable = useMemo(
    () => data && [...data, ...(html ?? []), ...(assets ?? [])],
    [data, html, assets],
  );
  // The pdfs among the assets, tree rows as images are (#361). Books stay out: they open beside
  // their note. Any case, since scans arrive as `PLAN.PDF`.
  const pdfs = useMemo(
    () => (assets ?? []).filter((path) => path.toLowerCase().endsWith(".pdf")),
    [assets],
  );
  // The csvs, video files and sounds among them, tree rows that open in the image's pane.
  const tables = useMemo(() => (assets ?? []).filter(isTreeFile), [assets]);
  // The tag vocabulary. Not archive-filtered: an archived note's tag is still a tag.
  const { data: tags } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  // Relation names, gated on the listing above so no request runs for a vault without the note.
  // Keyed as the editor reads notes, so the route's event handler keeps it fresh.
  const { data: ontology } = useQuery({
    queryKey: ["note", ONTOLOGY_NOTE],
    queryFn: () => fetchNote(ONTOLOGY_NOTE),
    enabled: data?.includes(ONTOLOGY_NOTE) === true,
    retry: false,
  });
  // Undefined until the note loads: an untold view must not read as a vault with no relations.
  const relations = useMemo(
    () => (ontology === undefined ? undefined : relationNames(ontology)),
    [ontology],
  );
  /**
   * Whether the archive is in what the four lookups answer with. React state only, so a reload
   * hides it again: a lookup that kept showing finished work would be a mode nobody remembers.
   */
  const [archive, setArchive] = useState(false);
  // One array per listing and toggle, or a finder keyed on `paths` rebuilds on every render (#586).
  const shown = useMemo(() => visible(data ?? [], archive), [data, archive]);
  // The same for the tree's rows, rebuilt whenever one of these arrives new (#589).
  const shownImages = useMemo(
    () => visible(images === undefined ? LOADING : [...images, ...tables], archive),
    [images, tables, archive],
  );
  const shownHtml = useMemo(() => visible(html ?? LOADING, archive), [html, archive]);
  const shownPdfs = useMemo(() => visible(pdfs, archive), [pdfs, archive]);
  // No `saveFirst`: this moves no path, it only changes what the lookups answer with.
  const commands = useMemo<Pick<TreeCommands, "toggleArchive">>(
    () => ({ toggleArchive: () => setArchive((previous) => !previous) }),
    [],
  );

  return {
    data,
    version,
    images,
    html,
    assets,
    linkable,
    tags,
    relations,
    archive,
    shown,
    shownImages,
    shownHtml,
    shownPdfs,
    commands,
  };
}
