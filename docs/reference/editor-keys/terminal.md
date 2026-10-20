---
type: Reference
title: Editor keys, terminal and chat
description: The terminal pane and the chat pane, their keys, their sessions and what the shell can reach.
resource: frontend/src/lib/key-bindings.ts
tags: [editor, keyboard, terminal, chat, frontend]
status: stable
---

# Terminals and chat

## Terminal

`<leader>cs` puts a shell in the focused pane. It opens a prompt asking what the
herdr session is called; letters, numbers, `-` and `_`, up to 64 characters. A
name nothing answers to starts a fresh session, and a name that is already
running attaches to it.

The multiplexer is [herdr](https://herdr.dev) rather than tmux, starting from
`shell/herdr.toml`, a config migrated from tmux. So the prefix is `Ctrl+Space`,
and `Ctrl+H`, `Ctrl+J`, `Ctrl+K` and `Ctrl+L` reach the shell as backspace,
newline, kill-line and clear. The entrypoint copies that file to
`~/.config/herdr/config.toml` in the container's home volume the first time
the container starts, and never again, so a setting saved in herdr's UI
survives a rebuild and a changed `shell/herdr.toml` reaches only a fresh
volume. herdr's sockets and session history live in the same volume, which is
what makes a session survive a restart.

The shell runs in its own container with the vault mounted at `/vault`, beside
jj, rg, git, Claude Code, codex and `dsh`, DeepSeek's harness. Nothing of your
own home directory is in there, and the vault is the only thing the container
shares with the machine.

Claude Code is not in the image. It is Anthropic's proprietary software, so
the container installs it on its first start, with Anthropic's installer and
under [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance),
into `~/.local/bin` in the home volume. That start needs network and takes
longer, by as long as the download does. Later starts find it there and skip the install, and
`claude update` updates it in place, so an update outlives a release. With no
network the shell still starts, the log says Claude Code could not be
installed, and the next start tries again.

The first time, log the agents in from inside the container. Each keeps its
credentials in the home volume (`~/.claude`, `~/.codex`, `~/.dsh`), so this
happens once and survives rebuilds and releases:

* `claude` asks you to log in when it first starts.
* `codex` does the same.
* `dsh` has no login. It reads a DeepSeek API key from the environment or
  `~/.dsh/.env`. It is optional: nothing starts it, neither the container nor
  the shell, so without a key everything else works and only `dsh` itself has
  nothing to talk to.

jj and git take their author from `JJ_USER` and `JJ_EMAIL`, which the
container reads at start and writes into the home volume only where no name or
email is set yet. See
[the shell container](/reference/configuration.md#the-shell-container).

This is a full shell with write access to the vault and every agent login you
have made. It must only be reachable behind the login gate; see
[Deploy to the VPS](/how-to/deploy-to-the-vps.md#prove-the-shell-is-not-exposed).

The session outlives the pane, the tab and
the browser, so closing the tab and coming back to the same name finds the same
shell with its scrollback and whatever was still running in it. Closing the pane
detaches a client; it does not kill the session.

When the connection goes, the pane says so in red. "Could not reach the shell"
means the WebSocket never opened: the shell container is down, the `/term`
route is missing, or the login gate turned the request away. "The shell closed
the connection" means it had opened and then ended. Neither retries on its
own; open the terminal again with `<leader>cs`.

The list under the input is the sessions that already exist, ranked against
what has been typed, so a half-remembered name is one Tab away and a click on a
row opens it. It offers rather than restricts: a name nothing answers to is
still taken, and starts a session.

A session you no longer want is closed from inside any terminal, in two steps,
because herdr will not delete one that is still running:

```sh
herdr session stop <name>
herdr session delete <name>
```

`stop` ends the session and everything in it; `delete` removes what it left
behind, and the name stops being offered here. A session that is stopped but
not deleted is still on the list, because the list is what exists.

It says what exists, not what is running. `GET /api/terminals` lists the
directory the shell container keeps one entry per session in, so the backend
never runs herdr and cannot start or stop anything; and `herdr --session`
attaches to a stopped session and starts a missing one alike, which makes the
distinction one you do not have to care about here. `herdr session list` inside
any terminal is where the running state is. The list is empty when the shell
container is not up, and the prompt is then a bare input.

The keys below are the only ones kasten takes back inside a focused terminal.
They are not leader keys and cannot be: the leader is the space bar and a shell
must receive the space bar, so nothing kasten owns can reach into a terminal as
a leader sequence. Every other key, the space bar included, goes to the shell.

| Key | Does |
| --- | --- |
| `Ctrl+Shift+H` | Move to the pane on the left |
| `Ctrl+Shift+J` | Move to the pane below |
| `Ctrl+Shift+K` | Move to the pane above |
| `Ctrl+Shift+L` | Move to the pane on the right |
| `Ctrl+Shift+O` | Move to the next pane |
| `Ctrl+Shift+P` | Open [the command palette](/reference/editor-keys/leader.md#the-command-palette) |
| `Ctrl+Shift+Q` | Take the terminal out of the pane |

They are `Ctrl+Shift` because a terminal cannot transmit most of those chords,
so claiming them costs the shell nothing. That is a reason to expect them to
work, not evidence that they are comfortable, and they are expected to change.
`TERMINAL` and `TERMINAL_CHORD` in `frontend/src/lib/key-bindings.ts` are the one
place to change them; the component, the `<leader>?` panel and its test all
derive from those two. This table does not, and has to be edited by hand.

On a touch screen, which is a coarse primary pointer, a row of keys sits under
the terminal, for what an on-screen keyboard lacks. A mouse never sees it.

| Key | Sends |
| --- | --- |
| `Esc` | Escape |
| `Tab` | Tab |
| `Ctrl` | Nothing by itself. It holds Ctrl for the next key and lets go after it; a second tap lets go at once |
| `←` `↓` `↑` `→` | The arrow, in the cursor mode the running program asked for, so they work in vim and less as well as at a prompt |
| `\|` `/` `-` | The character |

`Ctrl` applies to the next key from either keyboard. A letter typed after it
becomes the control character, so `Ctrl` then `c` is `Ctrl+C`. An arrow becomes
the Ctrl arrow, `/` and `-` become `Ctrl+_` and `|` becomes `Ctrl+\`, as on a
keyboard. Anything else typed goes through unchanged and still lets go of
Ctrl. What starts with an escape keeps Ctrl held: what the terminal reports by
itself (focus, the mouse, an answer to the program), a bracketed paste, and an
arrow from a hardware keyboard.

A tap on a key leaves the focus in the terminal, so the on-screen keyboard
stays up. A tap on the terminal focuses it. The terminal refits when the
keyboard opens and closes: the whole frame makes room for the keyboard, as
[The on-screen keyboard](/reference/editor-keys/touch.md#the-on-screen-keyboard) says, and the pane shrinks
with it.

`Ctrl+Shift+Q` empties the pane rather than removing it, which is what
`<leader>q` does to a note. That is also the way out of a window that holds
nothing but a terminal: there is no chord that splits, so with one terminal
pane the directions have nowhere to go and `Ctrl+Shift+O` wraps to itself. One
press puts an editor back in the pane and every leader key with it, splits
included. The herdr session goes on running either way, because closing the
socket detaches a client rather than ending the session.

They do not collide with herdr's own keys, which is the other reason to hold
`Ctrl+Shift`: herdr's prefix is `Ctrl+Space`, its tab keys are `Alt+Shift+H` and
`Alt+Shift+L`, and its pane navigation is `Ctrl+H` through `Ctrl+L`. Kasten
takes the shifted `Ctrl` variants and leaves all of those alone, so the six
chords move between kasten's panes and everything else moves within herdr's.

`Ctrl+Shift+H` is also Highlight in the editor. The two never meet: a chord
pressed in a focused terminal never reaches the editor, and formatting is bound
in insert and visual mode inside a note.

Leaving the browser tab and coming back puts the cursor where it was, in a
terminal pane as much as in a note. Only the focused pane claims it: every pane
would otherwise race for it on the way in, and a terminal has no editor to win
that race with, so the shell would sit there showing nothing focused and
dropping every key until you clicked into it.

A terminal pane is not in the URL. `?note=` names a note, and a terminal names
nothing, so a reload comes back to an empty pane. `<leader>cs` and the session
name is how you get back to it, which is the mechanism the sessions already have.

## The chat pane

`<leader>cc` puts a chat with Claude Code in the focused pane, replacing what
was there. It is the Claude Code of the shell container, in the vault, and the
session is the container's: closing the pane, a reload and another device all
come back to the same conversation.
[Run a skill from the chat pane](/how-to/run-a-skill-from-the-chat-pane.md)
walks through a run.

The pane takes the focus, not its message box, so the leader works at once.

| Key | Where | Does |
| --- | --- | --- |
| `i`, Enter | the pane | Move to the message box |
| Enter | the message box | Send. Under a coarse pointer it breaks the line, and `Send` sends |
| Shift+Enter | the message box | Break the line |
| Escape | the message box | Back to the pane |
| `<leader>` and a key | the pane | Every leader key. `<leader>q` takes the chat out of the pane |

In the message box and in a question's `Other` field a space is a space, so
the leader is reached from the pane, after Escape.

The header holds `/close-day` and `/process-meeting`, which send that text,
`Stop` while a run lasts, and `New`, which ends the session and empties the
pane. A tool call is a folded line that a click or Enter opens. A question a
skill asks is a form: radio buttons where it takes one answer, checkboxes where
it takes several, and an `Other` field for your own words. `Answer` is off
until every question has an answer.
