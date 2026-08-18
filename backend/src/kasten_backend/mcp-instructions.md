kasten serves one personal markdown vault: five capabilities and no shell.
There is no grep, no regex, no glob and no directory tree.

The vault is an Open Knowledge Format bundle whose notes link to each other with
[[wikilinks]], and it documents its own conventions. Read
"99 Misc/01 Config/reading-this-vault.md" before writing anything: it holds the
five-step rule by which a [[wikilink]] resolves, which you cannot guess, and
what the block at the top of a note carries.

list_notes returns note paths, for the whole vault or for one folder, and is how
you see the shape of the vault. search_notes is a fixed-string case-insensitive
scan of every line, not a regex, and it walks past the archive folder unless you
ask for it.

Writes are conditional. read_note returns a sha, and save_note and append_note
take that same sha back; pass none only when creating a note that is not there.
A stale sha is refused, so read before you write. The note's own frontmatter is
written for you, so never hand-write id, created or modified.

Four more guides sit in "99 Misc/01 Config/01 Agents/": Ontology.md for the note
types and the relations between them, How-To-Index.md for what an index.md or a
log.md carries, and How-To-TODO.md and How-To-Exam.md for the two formats a line
and a note are written in.
