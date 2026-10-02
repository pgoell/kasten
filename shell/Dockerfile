# syntax=docker/dockerfile:1.9
#
# shell/Dockerfile
#
# A browser-reachable shell beside the vault: ttyd over herdr, with the tools a
# session in the vault needs. Build context: repo root, so the CI image matrix
# reaches it with `shell/Dockerfile` the way it reaches the other two.
#
# Nothing here publishes a port. The only route in is Caddy's `handle /term/*`,
# which carries `import oauth2_auth`. See deploy/README.md.

# Built for linux/amd64 and linux/arm64. BuildKit fills TARGETARCH with one of
# the two, and each `FROM <tool>-${TARGETARCH}` line below picks the stage that
# fetches that architecture's binary, so a build only downloads its own.
# TARGETARCH is not declared here on purpose: BuildKit already defines it in
# the global scope, and an `ARG TARGETARCH` above the first FROM blanks it.

# The versions sit here, above every stage, so each architecture's stage reads
# the same one and only the checksum differs between them.
ARG TTYD_VERSION=1.7.7
ARG HERDR_VERSION=0.8.0
ARG JJ_VERSION=0.37.0
ARG RG_VERSION=14.1.1
ARG STARSHIP_VERSION=1.26.0

# ttyd serves the terminal. The release asset is a statically linked binary
# rather than an archive, so it is chmod'd rather than extracted. Version and
# checksum pinned together, the way the ones below are.
FROM debian:bookworm-slim AS ttyd-amd64
ARG TTYD_VERSION
ARG TTYD_SHA256=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55
ADD https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 /usr/local/bin/ttyd
RUN echo "${TTYD_SHA256}  /usr/local/bin/ttyd" | sha256sum -c - \
    && chmod +x /usr/local/bin/ttyd

FROM debian:bookworm-slim AS ttyd-arm64
ARG TTYD_VERSION
ARG TTYD_SHA256=b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165
ADD https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.aarch64 /usr/local/bin/ttyd
RUN echo "${TTYD_SHA256}  /usr/local/bin/ttyd" | sha256sum -c - \
    && chmod +x /usr/local/bin/ttyd

FROM ttyd-${TARGETARCH} AS ttyd

# herdr is the multiplexer the session lives in, in place of tmux, because it
# is what this box already runs and its config is the tmux config migrated. The
# release asset is a bare static binary, like ttyd's. The amd64 checksum came
# from https://herdr.dev/latest.json when 0.8.0 was current; that file names
# only the newest release, so the arm64 one was taken from the asset itself.
# Apache-2.0 since 0.8.0, checked against the LICENSE file in the tag.
FROM debian:bookworm-slim AS herdr-amd64
ARG HERDR_VERSION
ARG HERDR_SHA256=b872ea7e40fa2cb17e857ac9b62b1bf26db7b403c622f5d2f3f5b35f6e9acd28
ADD https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/herdr-linux-x86_64 /usr/local/bin/herdr
RUN echo "${HERDR_SHA256}  /usr/local/bin/herdr" | sha256sum -c - \
    && chmod +x /usr/local/bin/herdr

FROM debian:bookworm-slim AS herdr-arm64
ARG HERDR_VERSION
ARG HERDR_SHA256=f647ac66468d9efbc642fe534fb284468f0aea60641606fc008dfc0d82a3ca87
ADD https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/herdr-linux-aarch64 /usr/local/bin/herdr
RUN echo "${HERDR_SHA256}  /usr/local/bin/herdr" | sha256sum -c - \
    && chmod +x /usr/local/bin/herdr

FROM herdr-${TARGETARCH} AS herdr

# jj and rg again, spelled exactly as backend/Dockerfile spells them. Docker
# cannot share a stage between two Dockerfiles without a named build context,
# so the pins are copied and backend/tests/test_pins.py holds the copies
# together: a version or a checksum that drifts fails a test rather than
# shipping a container whose jj disagrees with the backend's.
FROM debian:bookworm-slim AS jj-amd64
ARG JJ_VERSION
ARG JJ_SHA256=7fd8e28d65106768054becbc1e0b929bed7c4c963d598f9f9a629bfa92eb7171
ADD https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/jj.tar.gz
RUN echo "${JJ_SHA256}  /tmp/jj.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/jj.tar.gz -C /usr/local/bin ./jj

FROM debian:bookworm-slim AS jj-arm64
ARG JJ_VERSION
ARG JJ_SHA256=f42164567abbcc0b13354eeb1ecd11f4245d7dce4de849bf794a4d5e1b615c62
ADD https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-aarch64-unknown-linux-musl.tar.gz /tmp/jj.tar.gz
RUN echo "${JJ_SHA256}  /tmp/jj.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/jj.tar.gz -C /usr/local/bin ./jj

FROM jj-${TARGETARCH} AS jj

FROM debian:bookworm-slim AS rg-amd64
ARG RG_VERSION
ARG RG_SHA256=4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e
ADD https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/rg.tar.gz
RUN echo "${RG_SHA256}  /tmp/rg.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/rg.tar.gz -C /usr/local/bin --strip-components=1 \
       ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl/rg

FROM debian:bookworm-slim AS rg-arm64
ARG RG_VERSION
ARG RG_SHA256=c827481c4ff4ea10c9dc7a4022c8de5db34a5737cb74484d62eb94a95841ab2f
ADD https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-aarch64-unknown-linux-gnu.tar.gz /tmp/rg.tar.gz
RUN echo "${RG_SHA256}  /tmp/rg.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/rg.tar.gz -C /usr/local/bin --strip-components=1 \
       ripgrep-${RG_VERSION}-aarch64-unknown-linux-gnu/rg

FROM rg-${TARGETARCH} AS rg

# starship draws the prompt, the same one the host's bash has. The tarball
# holds a single binary at its root. Each checksum is the `.sha256` published
# beside its asset, not one taken by hand.
FROM debian:bookworm-slim AS starship-amd64
ARG STARSHIP_VERSION
ARG STARSHIP_SHA256=b7c232b0e8249d8e55a40beb79c5c43a7d370f3f9408bd215deb0170daeaadf3
ADD https://github.com/starship/starship/releases/download/v${STARSHIP_VERSION}/starship-x86_64-unknown-linux-musl.tar.gz /tmp/starship.tar.gz
RUN echo "${STARSHIP_SHA256}  /tmp/starship.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/starship.tar.gz -C /usr/local/bin starship

FROM debian:bookworm-slim AS starship-arm64
ARG STARSHIP_VERSION
ARG STARSHIP_SHA256=dc30189378d2f2e287384e8a692d3f95ad1df64cf0e8c36aa9201516028aed6b
ADD https://github.com/starship/starship/releases/download/v${STARSHIP_VERSION}/starship-aarch64-unknown-linux-musl.tar.gz /tmp/starship.tar.gz
RUN echo "${STARSHIP_SHA256}  /tmp/starship.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/starship.tar.gz -C /usr/local/bin starship

FROM starship-${TARGETARCH} AS starship

# The three agents come from npm, and one of them may compile: dsh depends on
# node-pty, whose install script falls back to node-gyp, which wants python3
# and a compiler, when no prebuild fits. The pinned node-pty ships prebuilds
# for linux-x64 and linux-arm64, so today the fallback does not run on either
# image, but a dsh bump can move node-pty to a version where it does. The
# runtime has no use for the toolchain afterwards, so it is installed here and
# only the finished tree is copied over. The same node base is not a nicety: a
# `pty.node` is built against one node ABI and one CPU.
#
# Exact versions, not a range: an image rebuilt in six months should be the
# image that was tested. An update lands in the container's writable layer and
# so does not survive being recreated: the pin here is the floor a deploy
# returns to, and bumping it is how a version sticks.
#
# dsh is DeepSeek's harness, and the third agent. It is a developer preview, so
# the pin is an rc and moves often. It signs itself in unlike the other two: no
# browser login, a DeepSeek API key read from the environment or `~/.dsh/.env`,
# and `~/.dsh` sits in the home volume beside `~/.claude` and `~/.codex`, so a
# key set once outlives a release.
FROM node:24-bookworm-slim AS agents
ENV NPM_CONFIG_PREFIX=/opt/npm
RUN apt-get update \
    && apt-get install --no-install-recommends -y python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code@2.1.231 @openai/codex@0.147.0 \
       @deepseek-ai/dsh@0.1.0-rc.6

FROM node:24-bookworm-slim AS runtime

# curl and jq are for the backend: an agent in here completes a todo through
# `PUT /api/files`, which the vault's own `99 Misc/01 Config/01 Agents` note
# tells it to do, and node's `fetch` is a poor way to spell that in a shell.
#
# zsh is the shell this container hands you, with Debian's two completion
# plugins beside it. They are packaged, so nothing here is cloned at build.
RUN apt-get update \
    && apt-get install --no-install-recommends -y git ca-certificates less curl jq \
       zsh zsh-autosuggestions zsh-syntax-highlighting \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ttyd /usr/local/bin/ttyd /usr/local/bin/ttyd
COPY --from=herdr /usr/local/bin/herdr /usr/local/bin/herdr
COPY --from=jj /usr/local/bin/jj /usr/local/bin/jj
COPY --from=rg /usr/local/bin/rg /usr/local/bin/rg
COPY --from=starship /usr/local/bin/starship /usr/local/bin/starship

# uid 1000 so the vault bind mount is writable without root owning the notes,
# matching the backend container and the host user. The node image already
# holds that uid, so the user is renamed rather than added: a second passwd
# entry on the same uid would leave `whoami` and `$HOME` answering for whichever
# one comes first in the file.
RUN usermod --login kasten --home /home/kasten --move-home --shell /usr/bin/zsh node \
    && groupmod --new-name kasten node

# The prefix is /opt/npm rather than npm's own /usr/local, so the tree can
# belong to the user the shell runs as, which is what `claude update` needs to
# write; under /usr/local it would have to hand that user ttyd and herdr as
# well. The versions and the reason the install happens in its own stage are in
# the `agents` stage above.
ENV NPM_CONFIG_PREFIX=/opt/npm
ENV PATH=/opt/npm/bin:$PATH
COPY --from=agents --chown=kasten:kasten /opt/npm /opt/npm

# The default config, not the live one. herdr rewrites its config whenever a
# setting is changed in its UI, so the file it reads has to be writable and has
# to outlive a rebuild; the entrypoint copies this into the home volume the
# first time the container starts and never again. Everything else herdr keeps,
# its sockets, logs and session history, lives in that volume too, which is
# what makes a session survive a restart.
COPY shell/herdr.toml /etc/herdr/config.toml.default
COPY shell/entrypoint.sh /usr/local/bin/kasten-shell-entrypoint

# Appended, not copied over /etc/zsh/zshrc. Debian's file binds Home, End,
# Delete and the arrow keys from terminfo, and replacing it would leave a
# browser terminal where those keys print escape sequences.
COPY shell/zshrc /etc/zsh/zshrc.kasten
RUN echo '. /etc/zsh/zshrc.kasten' >> /etc/zsh/zshrc

USER kasten
WORKDIR /vault
ENV TERM=xterm-256color
# herdr spawns $SHELL. The passwd entry above says zsh too, for anything that
# reads that instead.
ENV SHELL=/usr/bin/zsh

ENTRYPOINT ["/usr/local/bin/kasten-shell-entrypoint"]

# No EXPOSE. The container is reached over the `web` network by name, and
# publishing a port would put a root-less but unauthenticated shell on the box.
#
# The command ends at `--session` with no name after it. `-a` appends the
# client's `?arg=` fragments after the server's own argv, so `?arg=agent-kasten`
# runs `herdr --session agent-kasten`, which herdr documents as use-or-create.
# A name here would push the client's into the next slot, where it is not an
# argument to `--session` at all.
#
# `-W` is not optional: ttyd has been read-only by default since 1.7.0, and
# without it the terminal looks alive and drops every keystroke.
CMD ["ttyd", "-W", "-a", "-b", "/term", "-p", "7681", "herdr", "--session"]
