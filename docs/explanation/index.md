# Explanation

Why kasten is built the way it is. These pages are for reading away from the
keyboard; they answer "why" rather than "how".

* [The vault and the derived index](vault-and-derived-index.md) - why the notes live on disk and Postgres is allowed to hold nothing that matters
* [Two environments](environments.md) - why dev and prod are deployed in deliberately different ways, and the constraints this box imposes on both
* [Deleting a note](deleting-a-note.md) - why a delete moves the note into a hidden folder instead of removing it
* [Live preview and the vim mode](live-preview.md) - why the editor renders markdown in normal mode and shows you the source in insert mode
* [The archive](the-archive.md) - why finished work goes in a folder rather than a field, and why one key rather than a filter on every list
* [Books in the vault](books-in-the-vault.md) - why a book is its note's path with the suffix swapped, and why the vault's history never takes a copy of one
