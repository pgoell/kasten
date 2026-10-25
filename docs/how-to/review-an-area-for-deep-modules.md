---
type: How-to Guide
title: Review an area for deep modules
description: Pick one area of the code, list its files and who imports them, ask of each file whether it hides work or only passes calls on, and file what should merge or move as refactor issues.
tags: [design, refactor, lint]
status: stable
---

# Review an area for deep modules

The lints look at one function or one file at a time. They do not see a task
spread over six shallow files, or a file that only hands calls on. This review
reads one area whole and files what should merge or move. Why the lints miss
this is in [Code quality checks](/explanation/code-quality-checks.md).

Run one when an area keeps producing bugs, or a file in it reaches 4,500
tokens. There is no schedule.

Every command below runs from the repository root.

## 1. Pick the area and list its files

An area is the code one feature lives in: the pane system, the todo pane, the
log. Start from the files whose names say so, then add the files they import
from the same feature and the ones that import them.

```sh
git ls-files frontend/src | grep -E 'pane|tab-'
```

Read the list and drop what belongs to another feature (each `*-pane.tsx` is
its own feature; the area is what arranges them). Write the list down: it heads
the findings.

## 2. Measure each file

For each file, its size in tokens, how many files import it, how many imports
it has, and how often it changed and broke:

```sh
for f in frontend/src/lib/panes.ts frontend/src/components/workspace-panes.tsx; do
  stem=${f#frontend/src/}; stem=${stem%.*}
  echo "$f tokens=$(( $(wc -c < "$f") / 4 ))" \
    "imported-by=$(grep -rlE "from \"@/$stem\"" frontend/src | wc -l)" \
    "imports=$(grep -c '^import' "$f")" \
    "commits=$(git log --oneline --since=3.months -- "$f" | wc -l)" \
    "fixes=$(git log --format=%s --since=3.months -- "$f" | grep -c '^fix')"
done
```

A file near 5,000 tokens with many fixes is where to read first. A file with
many imports and one importer is a place calls pass through.

Then list the open bugs in the area:

```sh
gh issue list --state open --search 'pane in:title'
```

## 3. Read each file and ask three questions

Read every file on the list in full. For each one, answer:

1. **Does a small interface hide real work, or does the file only pass calls
   on?** Count its exports and what each does. A function whose body is one
   call to another function with a fixed argument hides nothing. A component
   that takes twenty props and hands them to its children hides nothing either.
2. **How many files does one task touch?** Pick a change someone made or will
   make, such as adding a new kind of pane, and find every file it touches. The
   commit that last did it shows this:

   ```sh
   git log --format='%h %s' -S'history?: string' -- frontend/src/lib/panes.ts
   git show --stat <hash> -- frontend/src
   ```

   When one question ("what does this pane hold") is answered by a list written
   out in several files, grep for one item of the list and count the places:

   ```sh
   grep -rnE '\.history\b|"history"' frontend/src --include='*.ts*' | grep -v test
   ```

   Then check that every copy of the list holds the same items. A copy that
   lacks one is a bug; file it as a bug on its own.
3. **What should merge or move?** Two files that always change together should
   be one. Code in a file because that file already had the arguments it needed,
   and not because it belongs to the feature, should move. A file cut in two to
   fit the size limit, at a line count rather than along a module, shows in its
   first commit:

   ```sh
   git log --follow --format='%h %s' -- frontend/src/components/workspace-panes.tsx | tail -1
   ```

## 4. Write the findings

Keep three to five, worst first. Each finding names:

* the files and lines it is about;
* what one task costs today, in files touched;
* the change: what merges or moves, and the interface that is left;
* what it costs to change, and any reason in the code's own comments for the
  shape it has now, with an answer to that reason.

Drop a finding that only renames or only reorders. A finding has to make some
task touch fewer files or read less code.

## 5. File them

File each finding as its own issue labelled `refactor`, and `not-for-loop`
until the maintainer has picked which to build:

```sh
gh issue create --label refactor,not-for-loop \
  --title 'refactor(panes): <the change, in a few words>' \
  --body-file finding.md
```

File each bug found on the way as its own issue labelled `bug`, and link it
from the finding it showed. Then comment on the issue that asked for the
review with the list of files, the measurements from step 2 and a link to each
issue filed.

## Related

* [Code quality checks](/explanation/code-quality-checks.md): what each check catches and why the review exists beside them
* [The file size limit](/explanation/file-size-limit.md): what a deep module is, and why a file is split along one
* [Run the checks](/how-to/run-the-checks.md): the lints this review does not replace
