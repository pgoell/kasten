# How-to guides

Recipes for jobs you already know you need. Each one assumes you have kasten
running; if you do not, start with [Self-host on a server](/tutorials/self-host-on-a-server.md)
to run it for real, or [Getting started](/tutorials/getting-started.md) to work
on its code.

* [Add a database migration](add-a-database-migration.md): generate, review and apply an Alembic migration against the dev database
* [Back up and restore](back-up-and-restore.md): the three things a self-hosted kasten holds, a nightly tar or a jj push, and the restore
* [Capture from your phone](capture-from-your-phone.md): send a thought into today's dump from a phone, and share links and text into it from other apps on Android
* [Connect an agent](connect-an-agent.md): mint and revoke a token, then connect Claude Code, codex, Claude Desktop, claude.ai, chatgpt.com, another MCP client or curl, or install the skill where MCP is off
* [Cut a release](cut-a-release.md): run `mise run release` on a clean `main` or a worktree at `origin/main`, which picks the version from the commits and publishes it, then watch it deploy
* [Deploy to the VPS](deploy-to-the-vps.md): the maintainer's own deployment, as a worked example: bootstrap dev and prod on the box, on amd64 or arm64, deploy day to day, open the chat route, and prove the shell is still behind its gate
* [Import from Firefly III](import-from-firefly-iii.md): a one-off, bring Firefly III's history into kasten once from a one-shot container, count first with a dry run, and check a second run changes nothing
* [Import an Anki deck](import-an-anki-deck.md): turn an .apkg export into markdown notes, and know what does not survive the trip
* [Install kasten on your phone](install-on-your-phone.md): put kasten on a phone's home screen, reach the capture page from its icon, and replace the capture app an earlier release installed
* [Read the finance overview](read-the-finance-overview.md): free to spend for mine and household and what makes it, what to watch, the month's pace, where its money went, drill down into a scope, account, category, payee or booking, read a quarter or a year against a year before, pull from the bank now, set or change a limit, take a suggested one, set every limit at once, and find a booking
* [Plan costs and goals](plan-costs-and-goals.md): confirm plans proposed from history, add and change a plan, see what is due this month and what met it, set a saving goal and assign money to it each month
* [Sort finance transactions](sort-finance-transactions.md): open the finance pane on the bookings still to sort, sort one with a key or a tap, and send every booking of a payee to one category
* [Use the log pane](use-the-log-pane.md): open the log pane, read a day's totals against your goals, log on any day, fix or delete an entry, and read the trends
* [Add a food of your own](add-a-food-of-your-own.md): save a food Open Food Facts lacks to the foods note, from the food search or by hand, so the search lists it first and its barcode scans
* [Log food from a phone](log-food-from-a-phone.md): scan a food's barcode with the phone camera and log it on today's note, and what to do when the camera is refused or the barcode is unknown
* [Read the overview](read-the-overview.md): open the overview of scores and streaks, read its eight cards, open the pane behind one, and know the streak rules and what counts as a note written
* [Read the year and week review](read-the-year-and-week-review.md): read the year review on a yearly note and the week review on a weekly one, know what each section counts and how each number is worked out, and switch on the GitHub section
* [Recover an earlier version of a note](recover-an-earlier-version.md): read back or restore a note as it was before a save overwrote it, from the history pane or with jj
* [Regenerate the API types](regenerate-the-api-types.md): rebuild the frontend's TypeScript types after changing a backend endpoint
* [Review an area for deep modules](review-an-area-for-deep-modules.md): list one area's files and who imports them, ask of each whether it hides work or only passes calls on, and file what should merge or move as refactor issues
* [Collect receipts](collect-receipts.md): get tax receipts in from the finance pane, the phone and Gmail, set up the receipt job that reads each one with headless Claude Code on your subscription, confirm what kasten proposes, and read and export the tax year
* [Run the order sync](run-the-order-sync.md): set up the PayPal and Amazon order mail job with a read-only Gmail login in `~/.config/kasten`, check what it reads, start it on a systemd timer, and read the orders no booking holds yet
* [Run the bank sync](run-the-bank-sync.md): set up the bank sync on the server with its env file and FinTS state in `~/.config/kasten`, log in to each bank once, start it on systemd timers, ask for a pull now, and read the status
* [Run the checks](run-the-checks.md): run the linters, tests and type checks, and get past the two ways the git hooks go wrong
* [Self-host kasten](self-host-kasten.md): run kasten on one machine of your own, amd64 or arm64, behind basic auth, oauth2-proxy or Tailscale
* [Run a skill from the chat pane](run-a-skill-from-the-chat-pane.md): open the chat pane, start `/close-day` or `/process-meeting`, answer a question, read a tool call, stop a run and start a new session, at a desk and on a phone
* [Troubleshoot a self-hosted kasten](troubleshoot-self-hosting.md): why the stack will not start, get a certificate, let you in, save a note, open a terminal or connect the chat pane
* [Upgrade kasten](upgrade-kasten.md): move to a new release, pinned or on latest, check it, and roll back
* [Use kasten on a phone](use-kasten-on-a-phone.md): open the file tree, find a note, run a command, turn vim on, move between the panes of a split, tick a todo, settle a note that changed on disk, type in a terminal and close a panel, by touch
* [Write a practice exam](write-a-practice-exam.md): put a set of questions in the vault so kasten can ask them one at a time and score the sitting

Why the two environments are built in opposite ways is
[Two environments](/explanation/environments.md), not a how-to.
