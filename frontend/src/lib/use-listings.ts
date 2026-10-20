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

/**
 * What a list prop gets while its query loads: one array, so the memo the
 * component builds over it holds. A fresh `[]` per render builds it again.
 */
const LOADING: string[] = [];

export type Listings = ReturnType<typeof useListings>;

/**
 * Every listing the route draws from, with the archive filter applied, and the
 * one command that toggles it.
 */
export function useListings() {
  const { data } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  // Asked once and never again: the bundle in front of you was stamped when
  // this tab loaded it, so a backend that reloads under a newer commit would
  // otherwise draw half a reading nothing on screen came from.
  const { data: version } = useQuery({
    queryKey: ["version"],
    queryFn: fetchVersion,
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Beside the notes rather than inside them: an image is a row of the tree and
  // a path an `![](` completes to, and nothing else in the app reads it. The
  // event stream refetches it on a `listing`, which is the event a change to
  // anything that is not a note fires.
  const { data: images } = useQuery({ queryKey: ["images"], queryFn: fetchImages });
  // The pages of HTML a research run leaves, which are rows of the tree and
  // nothing else. Refetched on a `listing` beside the images.
  const { data: html } = useQuery({ queryKey: ["html"], queryFn: fetchHtml });
  // Every book, pdf and picture, which `[[plan.pdf]]` links to and nothing
  // else here reads. Refetched on a `listing` beside the pages.
  const { data: assets } = useQuery({ queryKey: ["assets"], queryFn: fetchAssets });
  // What a `[[link]]` can land on: the notes, and the pages and assets beside
  // them. Absent while the notes load, so the editor calls no link dead before
  // it knows.
  const linkable = useMemo(
    () => data && [...data, ...(html ?? []), ...(assets ?? [])],
    [data, html, assets],
  );
  // The pdfs among the assets, which are rows of the tree the way images are
  // (#361). The books stay out, a book being opened beside its note and never
  // from a row. Any case, a scan arriving as `PLAN.PDF` as often as not.
  const pdfs = useMemo(
    () => (assets ?? []).filter((path) => path.toLowerCase().endsWith(".pdf")),
    [assets],
  );
  // The vault's tag vocabulary, for the completion an open `#` offers. Not
  // filtered by the archive toggle: a tag written in an archived note is
  // still a tag, and spelling it the same way is the whole point.
  const { data: tags } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  // The vault's own vocabulary, for the completion a relation name is offered
  // by. Gated on the listing above, the way the todo pane asks whether the
  // vault holds its views note: no request for a vault that has none, and no
  // `try` around a `GET` that would have to tell a missing note from a backend
  // that is down. The key is the one the editor reads notes with, so the
  // route's own event handler keeps it fresh and an edit to the vocabulary
  // reaches the completion without a reload.
  const { data: ontology } = useQuery({
    queryKey: ["note", ONTOLOGY_NOTE],
    queryFn: () => fetchNote(ONTOLOGY_NOTE),
    enabled: data?.includes(ONTOLOGY_NOTE) === true,
    retry: false,
  });
  // Undefined until the note is in hand, so a view that has not been told
  // anything is told nothing rather than told the vault names no relations.
  const relations = useMemo(
    () => (ontology === undefined ? undefined : relationNames(ontology)),
    [ontology],
  );
  /**
   * Whether the archive is in what the four lookups answer with.
   *
   * React state and nothing more, so a reload puts it back to hidden, where
   * the pane arrangement comes back: a lookup that quietly kept showing
   * finished work would be the mode you forgot you were in.
   */
  const [archive, setArchive] = useState(false);
  // One array per listing and toggle, because `visible` filters into a new one
  // each call and a finder keyed on `paths` would build its candidates again
  // on every render of the route (#586).
  const shown = useMemo(() => visible(data ?? [], archive), [data, archive]);
  // The same for the tree's other rows, which it builds again whenever one of
  // these arrives new (#589).
  const shownImages = useMemo(() => visible(images ?? LOADING, archive), [images, archive]);
  const shownHtml = useMemo(() => visible(html ?? LOADING, archive), [html, archive]);
  const shownPdfs = useMemo(() => visible(pdfs, archive), [pdfs, archive]);
  // No `saveFirst`: this opens nothing and moves no path, it only changes
  // what four lookups answer with.
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
