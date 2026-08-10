# kasten: project instructions

A self-hosted markdown notebook with wikilinks and backlinks, in the shape of
Obsidian but served as a web page. Single user, running on a Hetzner VPS behind
oauth2-proxy.

## The one rule

The vault is a directory of `.md` files and it is the source of truth. Postgres
holds a derived index only, and you must be able to drop the schema and rebuild
it from the vault. Nothing that only exists in the database is allowed to
matter.

Check any change you make against that rule before you write it. The reasoning
is in [The vault and the derived index](../docs/explanation/vault-and-derived-index.md).

## What exists today

Real, working code, not a plan:

- `backend/`: FastAPI on Python 3.14, SQLAlchemy 2 async, Alembic, uv. Eleven
  endpoints, `/api/health`, `/api/files`, `/api/search`, `/api/todos`,
  `/api/terminals`, `/api/events`, `GET`,
  `POST`, `PUT` and `PATCH` on `/api/files/{path}`, and `PATCH` on
  `/api/folders/{path}`. A create starts a
  note holding its frontmatter, and the text under it when a body comes with
  the request, and makes the folders on the way to it; a `PATCH`
  gives a note or a folder a new path and takes the folders it emptied with it. A folder moves in
  one rename, so its whole subtree arrives together. Both moves rewrite every
  `[[link]]` in the vault that named what moved, each in the spelling it had,
  reading only the notes rg names rather than the whole vault. All four writes are
  recorded in the vault's jj repo, one change per note, and skipped when the
  vault has none. Every note carries a `---` block holding a uuid7 `id`, a
  `created` date and a `modified` date; a create writes it and a save rewrites
  the date, keeping the id, the creation date and every field that is not
  kasten's. `/api/events` streams every change to the vault as server-sent
  events, one per note with a sha256 of what is on disk, plus one `listing`
  when the shape of the vault moved, which is how a folder move arrives.
  Nothing under a dot-directory is reported, so the jj repo stays off it.
  `/api/todos` is search's one rg pass asked a different question: it answers
  with every checkbox line the vault holds, in search's own shape, and parses
  none of them, the client reading the format. Its pattern also matches a
  `- HH:MM-` session line with no end on it, which is a timer still going. A
  closed one is deliberately left out: the total is on the task line, and the
  closed ones are the half of that log that piles up. A stop reads them through
  `/api/search` on the id instead.
  `/api/terminals` is the one endpoint that reads nothing of the vault: it
  lists the shell container's herdr sessions off a read-only mount of that
  container's volume, so the prompt can offer the ones that already exist.
  Settings via pydantic-settings with the `KASTEN_` prefix.
- `frontend/`: React 19, Vite, TanStack Router and Query, Tailwind 4,
  CodeMirror 6 with vim mode, bun. A vault file tree, and a markdown editor
  that opens the note you click and writes it back as you type, or on `:w`.
  One prompt does three jobs: `Space c f` makes a note at a path you type,
  `Space r f` moves one that is there, and the tree's own `r` renames whatever
  the cursor sits on, a folder included. The tree's `c` is `Space c f` from
  there. All three complete the vault's folders. A finder opens a note by name:
  `Space f f`, or `f` in the tree, ranks every note in the vault against what
  you type and shows the one under the highlight beside the list. Search reads
  what is written in the notes instead: `Space f g`, or `s` in the tree, asks
  rg for the lines holding what you type and ranks them here, and Enter opens
  the note on the line. `[[wikilinks]]` render as the note's name, and `gf` or
  ctrl+click opens it: a target with a slash is a path, a bare name is looked
  for anywhere in the vault, and a name nothing answers to is made and opened.
  Typing `[[` offers the vault's notes and closes the link it completes, and a
  link to a note that is not there yet is drawn muted and dotted. Both read the
  listing off the editor state, which the route reconfigures as it changes.
  The links are read both ways from a panel: `Space g b` shows what links to the
  open note, drawn as search draws its hits, and `Space g o` shows what it links
  to, drawn as the finder draws its notes. Tab walks the rows in either.
  Five more `g` keys open the note covering today: `Space g d` the day,
  `g w` the week, `g m` the month, `g q` the quarter and `g y` the year. They
  live under `01 Periodic`, one numbered folder each, and the key makes the
  note if the vault has none. A fresh one carries a heading and one line of
  links: back one, up to the note holding it, and on one, written whether or
  not those notes exist yet, so `gf` walks the chain and makes what it reaches.
  The week is the ISO one, counted from its Thursday.
  A todo is a checkbox line in a note, and the line is the whole record: five
  states, `[ ] [/] [x] [b] [-]`, and every field beside them spelled the way
  obsidian-tasks spells it, the dates `📅 ⏳ 🛫 ➕ ✅ ❌`, a priority glyph, and
  `🔁 🆔 ⛔ ⏲ ⏱`. `Space x` walks the line under the cursor
  through the work, plain line to open to doing to done and out to a plain line
  again, stamping the created date, the done date and the id as it goes, and the
  editor draws each state as a symbol with an overdue date in red. Blocked and
  rejected are not on the walk: five keys set a state straight, `Space s o p x b
  r` in the editor and `O P X B R` in the pane, stamping and dragging what the
  walk does. Done is the walk's last state because a list of open work loses the
  row there, which once put blocked and rejected out of the pane's reach.
  `Space i` stamps an id on its own, which is how an open todo gets a name for a
  `⛔` to point at.
  A todo indented under another is a part of it, the indent being the whole
  rule, and the parent carries `1/3` after its words in the editor and on its
  row, counting every descendant. Ticking a parent ticks every open part with
  it, in one press one `u` takes back, and writes one `- ✅` line naming the
  parent. Ticking the last part leaves the parent alone.
  `⛔` names another todo's id and hands kasten the choice between `[ ]` and
  `[b]` on that line: closing or reopening the blocker rewrites every dependent
  naming it, wherever it lives, reading `GET /api/todos` once to find them and
  reading only the notes that hold one. `[/]`, `[x]` and `[-]` are never
  touched, a dependent opens only when every blocker on it is closed, and a
  `⛔` naming an id no note holds changes nothing.
  `🔁 every week`, `every 3 days` and the `when done` suffix are read, and
  ticking such a todo leaves the completed line where it is and puts the next
  copy above it, one period on, with every date it carries moved by the same
  number of days and the id and the done date dropped. A month rule clamps to
  the last day of a month too short for the day. The press
  that enters or leaves done moves the done log too. For a todo in another note
  that is a write no buffer edit can reach, so `u` puts the line back and leaves
  the log; for one already in today's note the log lands in the same buffer, in
  the same transaction, and `u` takes back both. `Space g t`
  puts the list in the focused pane, a third thing a pane can hold beside a note
  and a terminal, grouped under Overdue, Today, This week, Later and No date.
  A row sits in the group its scheduled date names where it has one and its due
  date otherwise, a past due date wins over both, and a `🛫` after today keeps
  the row off the list until the day it names. A part is drawn one step in under
  the todo it belongs to, and where that todo is in another group or already
  done it names it in front of its own words instead.
  Its keys are `j k Enter x O P X B R a t d n v / q Escape`: `x` walks a todo in the vault,
  `a` opens a prompt turning one line of shorthand, `call the dentist due:08-14
  est:45m !high #health`, into a todo under `## TODOs` in today's note, `est:`
  being the one path by which kasten rather than your keyboard writes a `⏲`,
  `t` starts and stops a timer, `d` shows the
  last seven days of finished work, `n` shows one next action per top level
  todo, the first open leaf under it or whatever carries `#next`, and `/`
  narrows the list by tag, priority, state and due window. `v` walks the named
  filters `99 Misc/01 Config/todo-views.md` holds, one per list item, name up to
  the first colon and terms after it: the terms of the one showing sit in the
  filter line and its name in the header, one press past the last gives the whole
  list back, and typing over the terms clears the name. The first `v` in a vault
  with no such note writes it, holding `today`, `doing` and `important`, the way
  the periodic keys write the note they open. `Space f t` is the same list in the finder's panel.
  Ticking a todo done also writes a `- ✅` line under `## Done` in today's note,
  linking back and naming the id; un-ticking drops that line wherever it landed,
  and ticking twice leaves one. It is deliberately not a checkbox, so
  `/api/todos` cannot match it. A fresh daily note carries `## TODOs`, and
  `## Done` is made by the first write into it.
  `t` in the pane starts a session on the todo under the cursor and writes it
  under `## Time` in today's note, `- 14:03-      the words [[the note]] kt-…`,
  stamping an id where the todo carried none so the line has something to name.
  A second press closes every session that todo has running and rewrites its
  `⏱` as the sum of every closed session naming it, across the vault, read
  through one `/api/search` on the id. The log is the record and `⏱` is the
  summary of it, so a session line corrected by hand puts the total back in
  step and a hand typed total the log does not back is replaced. Timers run in
  parallel, and a row with one going carries `▶` and the pane's footer counts
  them. A session is closed in the note it lives in, at 23:59 when that note is
  not today's, which is one rule for the timer somebody forgot and for the one
  that ran past midnight; a session in a note that is not a daily note is left
  alone, nothing saying which day it belongs to. The row shows what is on disk,
  so nothing ticks.
  `Space c s` puts a shell in the focused pane instead of a note: it asks what
  the herdr session is called, offering the ones that already exist, and
  attaches to it, starting one if nothing answers to that name. The pane speaks ttyd's WebSocket protocol itself
  through a pure codec and an xterm terminal, painted in One and fitted to the
  pane, so a terminal pane and a note pane are one window. The leader cannot
  reach into a focused terminal, the leader being the space bar and a shell
  needing it, so six `ctrl-shift` chords walk the panes and close one:
  `H J K L` for the directions, `O` for the next and `Q` to close. Closing a
  pane detaches a client rather than killing the session, so the session
  outlives the pane, the tab and the browser.
  The window divides the way tmux divides a terminal. `Space %` and `Space "`
  split the focused pane left and right or top and bottom, `Space h j k l`
  moves to the pane in that direction and `Space o` walks them in order,
  and `Space c t` starts a tab, walked with `Space t l` and `Space t h`
  or reached by `Space 1` to `Space 0`. A split makes an empty pane and moves
  to it, and every key above acts on the pane that has the focus. `Space q`
  walks back out one press at a time: the note, then the pane, then the tab,
  and it stops at the last pane of the last tab. The arrangement lives in React
  state, so a reload drops it.
  The note in the focused pane lives in the URL as `?note=` and the line as
  `?line=`, and the note follows a folder that moves out from under it. The
  frontmatter is drawn as YAML rather than as markdown, and the cursor opens on
  the first line under it.
  One `EventSource` on `/api/events` answers what the vault does behind the
  app: the tree refetches its listing, a note nobody is typing into takes the
  new text with the cursor where it was, and one holding unsaved edits stops
  autosaving and reads `Changed on disk`. Two commands end that: `:w` keeps
  your text and `:e!` takes the vault's. Until one of them does, every key
  that would leave the note refuses and flashes the bar, the pane and tab
  keys included, and only a mouse click into another pane still writes past it.
- `shell/`: a Dockerfile and a herdr config. ttyd over herdr on a node base,
  with the vault mounted and jj, rg, git, Claude Code and codex beside it. The
  config is the one this VPS runs, migrated from its tmux config, baked into
  the image and read through `HERDR_CONFIG_PATH`. The
  agents are fresh installs signing themselves in inside the container, into a
  named volume; nothing of the host's home is mounted, so the vault is the only
  thing they share with you. It publishes no port; the only route in is a Caddy
  `handle /term/*` carrying `import oauth2_auth`. The one dev service built on
  the box, because there is no reload loop to bind-mount a tree into.
- `deploy/`: dev and prod compose files. Dev bind-mounts the tree and reloads;
  prod pulls GHCR images and deploys from a GitHub release. Three images now,
  the shell among them.
- `vault/`: the notes, and a colocated jj repo holding their history.

Search reads the vault with rg on every query and indexes nothing, so it is
not a reason to start writing to Postgres. A move's link rewrite uses rg too, to
pick the few notes it has to read, so there is no link table either.

Not built yet: deleting notes or folders, making a folder on its own, merging
two folders, and anything that writes to Postgres.
The database schema is empty beyond Alembic's own table. Do not document these
as though they exist.

## Commands

mise owns every command. `mise tasks` lists them, and
[the reference page](../docs/reference/mise-tasks.md) explains them by group.
The ones you need most:

```sh
mise run dev        # backend on :8000
mise run fe:dev     # frontend on :5173
mise run test       # backend and frontend tests
mise run lint       # ruff, ty, biome
mise run db:migrate # apply migrations to the dev database
```

Two failure modes worth knowing before you lose an hour to them:

- A git hook that hangs printing nothing is mise waiting to trust the config.
  Run `mise trust`. Every fresh clone and every new worktree hits this.
- Frontend tests failing locally while CI is green usually means `node_modules`
  is a bun install on top of an old pnpm tree. Delete it and reinstall.

## Documentation

`docs/` is a [Diátaxis](https://diataxis.fr) tree written in
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
v0.2. Read [docs/index.md](../docs/index.md) first; it explains the arrangement.

When you add or change a page:

- Every page except `index.md` and `log.md` carries YAML frontmatter, and
  `type` is required. Use the quadrant as the type: `Tutorial`,
  `How-to Guide`, `Reference` or `Explanation`. Add `title`, `description`,
  `tags` and `status` too.
- Put the page in the quadrant that matches its job. A tutorial teaches a
  beginner, a how-to serves someone who knows what they want, a reference
  states what is there, an explanation gives the why. Mixing two of those into
  one page is the failure this structure exists to prevent.
- Link between pages with bundle-relative markdown links, `/reference/http-api.md`.
- Update the `index.md` of the directory you touched, and add a dated entry to
  `docs/log.md`.
- Never add AI attribution, so no `generated:` or `verified:` frontmatter.

Deployment stays in `deploy/README.md`, next to the compose files it describes.

Documentation describes what the code does now. If a change makes a page wrong,
fix the page in the same pull request.

## Development workflow

Test-driven, red-green-refactor. Write the failing test, watch it fail for the
right reason, then write the code. The repo has real tests on both sides:
pytest in `backend/tests/`, vitest in `frontend/tests/`.

Work happens on a branch and lands through a pull request. Lefthook runs `lint`
before a commit and the tests plus the frontend typecheck before a push. CI
runs Lint and Test, and both must pass before main will take the merge. Main
requires linear history and merge commits are off, so squash or rebase.

The version lives in `backend/pyproject.toml` and nowhere else; the backend
reads it back off the installed package. A release is a bump plus a tag, and the
deploy workflow refuses one whose tag disagrees. The sequence, and how to read
the next number off the commit subjects, is in
[Cut a release](../docs/how-to/cut-a-release.md).

Verify before you claim. A change is done when you have run the thing, not when
it looks right.

## Coding standards

- **No bare catchalls.** No untyped `catch` in TypeScript, no bare `except:` in
  Python. Catch the error you can handle and let the rest propagate.
- **No dynamic imports.** Keep the dependency graph analyzable.
- **Comments explain why.** The code already says what it does. A comment earns
  its place by recording the constraint, the surprise or the reason for a
  choice that looks odd. Match the density of the surrounding file.
- **SHA-pin third-party GitHub Actions.** `actions/*` and `github/*` may use
  `@vN`; everything else pins a full commit SHA with a trailing `# vX.Y.Z`.
- **Conventional Commits.** `<type>(<scope>)?: <subject>`, subject lowercase.
  `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`,
  `chore`, `revert`. Append `!` for breaking changes. PR titles follow the same
  rule. Nothing enforces this automatically, so it is on you.
- **Never add AI attribution** to commits, PRs, code or docs. No "Generated
  with", no "Co-Authored-By: Claude".

## Writing style

Applies to all prose: docs, commit messages, PR bodies, code comments.

- No em-dashes (—) or en-dashes (–). Rewrite with commas, periods, colons,
  semicolons, parentheses, or split the sentence.
- No hyphens standing in for punctuation mid-sentence. Hyphens inside compound
  words are fine, and markdown horizontal rules are structural.
- Short words over long ones, active over passive, and cut what does not earn
  its place.

One exception, and it is deliberate: `index.md` files in `docs/` use the
`* [Title](url) - description` form because OKF specifies that shape for
directory listings.
