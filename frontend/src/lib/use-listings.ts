import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  fetchAssets,
  fetchFiles,
  fetchHtml,
  fetchImages,
  fetchNote,
  fetchTags,
  fetchVersion,
} from "@/lib/api";
import { visible } from "@/lib/archive";
import type { TreeCommands } from "@/lib/key-bindings";
import { ONTOLOGY_NOTE, relationNames } from "@/lib/ontology";

/** What a list prop gets while its query loads: one array, so the memo built over it holds. */
const LOADING: string[] = [];

export type Listings = ReturnType<typeof useListings>;

/** Every listing the route draws from, with the archive filter applied, and the toggle for it. */
export function useListings() {
  const { data } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  // Fetched once. The bundle's stamp is from tab load, and a newer backend would mix versions.
  const { data: version } = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Beside the notes, not in them: images are tree rows, and `![](` completes to their paths.
  // A `listing` event refetches them, since it fires for any change that is not a note.
  const { data: images } = useQuery({ queryKey: ["images"], queryFn: fetchImages });
  // HTML pages a research run leaves: tree rows only. Refetched on a `listing` like the images.
  const { data: html } = useQuery({ queryKey: ["html"], queryFn: fetchHtml });
  // Books, pdfs and pictures, which `[[plan.pdf]]` links name. Refetched on a `listing` too.
  const { data: assets } = useQuery({ queryKey: ["assets"], queryFn: fetchAssets });
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
  const shownImages = useMemo(() => visible(images ?? LOADING, archive), [images, archive]);
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
