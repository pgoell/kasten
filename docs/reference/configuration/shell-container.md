---
type: Reference
title: The shell container
description: The variables the shell container reads, the uid it runs as, and what its entrypoint installs on first start.
resource: shell/entrypoint.sh
tags: [config, shell, terminal]
status: stable
---

# The shell container

The shell container is not the backend and reads no `KASTEN_` setting of its
own beyond `KASTEN_API`. Two more variables set who a commit made in it is by.

| Variable | Sets |
| --- | --- |
| `JJ_USER` | jj's `user.name` and git's `user.name` |
| `JJ_EMAIL` | jj's `user.email` and git's `user.email` |

The entrypoint reads them each time the container starts and writes a value
into the home volume only where that key is empty, so a name set by hand inside
the container is never replaced. Unset or empty, it writes nothing. It then
removes both from the environment the shell gets, because jj reads `JJ_USER`
and `JJ_EMAIL` itself ahead of any config file, and left in place they would
override what the volume holds.

The container runs as any uid and gid compose gives it. One with no line in
the image's `/etc/passwd` gets one through nss_wrapper, named `kasten` with
`/home/kasten` as its home. A fresh home volume is writable by every uid; one
made under another uid is not, and the shell then stops with a line in its
log saying so.

On its first start the entrypoint installs Claude Code into `~/.local/bin` in
the home volume, with Anthropic's installer and under Anthropic's terms,
because the published image does not carry it. That start needs network to
reach `claude.ai` and takes longer. It installs only when no `claude` is on
`PATH`, and a failed install is logged and does not stop the shell.

After that it installs the Claude Agent SDK into `~/.kasten-chat`, at the
version `KASTEN_AGENT_SDK_VERSION` in the image names, and starts
[the chat runner](/reference/chat-runner.md) on port `7682`. Both happen in
the background, so the shell does not wait for them. A release that moves the
pin replaces the copy in the volume on its first start.

| Variable | Set on | What it does |
| --- | --- | --- |
| `KASTEN_AGENT_SDK_VERSION` | the image | the SDK version the entrypoint installs. Change it in `shell/Dockerfile`, not in compose |
| `CLAUDE_CODE_OAUTH_TOKEN` | the shell container, optional | signs Claude Code in without the interactive login. From `claude setup-token` |
| `ANTHROPIC_API_KEY` | never | Claude Code prefers it to the subscription login, so every run in the terminal and the chat pane would be billed to the API account |
| `KASTEN_DEV_CHAT` | the frontend dev server | where vite proxies `/chat`. Default `http://localhost:7682` |
