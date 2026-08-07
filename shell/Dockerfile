# syntax=docker/dockerfile:1.9
#
# shell/Dockerfile
#
# A browser-reachable shell beside the vault: ttyd over tmux, with the tools a
# session in the vault needs. Build context: repo root, so the CI image matrix
# reaches it with `shell/Dockerfile` the way it reaches the other two.
#
# Nothing here publishes a port. The only route in is Caddy's `handle /term/*`,
# which carries `import oauth2_auth`. See deploy/README.md.

# ttyd serves the terminal. The release asset is a statically linked binary
# rather than an archive, so it is chmod'd rather than extracted. Version and
# checksum pinned together, the way the two below are.
FROM debian:bookworm-slim AS ttyd
ARG TTYD_VERSION=1.7.7
ARG TTYD_SHA256=8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55
ADD https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.x86_64 /usr/local/bin/ttyd
RUN echo "${TTYD_SHA256}  /usr/local/bin/ttyd" | sha256sum -c - \
    && chmod +x /usr/local/bin/ttyd

# jj and rg again, spelled exactly as backend/Dockerfile spells them. Docker
# cannot share a stage between two Dockerfiles without a named build context,
# so the pins are copied and backend/tests/test_pins.py holds the copies
# together: a version or a checksum that drifts fails a test rather than
# shipping a container whose jj disagrees with the backend's.
FROM debian:bookworm-slim AS jj
ARG JJ_VERSION=0.37.0
ARG JJ_SHA256=7fd8e28d65106768054becbc1e0b929bed7c4c963d598f9f9a629bfa92eb7171
ADD https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}/jj-v${JJ_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/jj.tar.gz
RUN echo "${JJ_SHA256}  /tmp/jj.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/jj.tar.gz -C /usr/local/bin ./jj

FROM debian:bookworm-slim AS rg
ARG RG_VERSION=14.1.1
ARG RG_SHA256=4cf9f2741e6c465ffdb7c26f38056a59e2a2544b51f7cc128ef28337eeae4d8e
ADD https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl.tar.gz /tmp/rg.tar.gz
RUN echo "${RG_SHA256}  /tmp/rg.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/rg.tar.gz -C /usr/local/bin --strip-components=1 \
       ripgrep-${RG_VERSION}-x86_64-unknown-linux-musl/rg

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --no-install-recommends -y tmux git ca-certificates less \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ttyd /usr/local/bin/ttyd /usr/local/bin/ttyd
COPY --from=jj /usr/local/bin/jj /usr/local/bin/jj
COPY --from=rg /usr/local/bin/rg /usr/local/bin/rg

# Exact versions, not a range: an image rebuilt in six months should be the
# image that was tested.
RUN npm install -g @anthropic-ai/claude-code@2.1.224 @openai/codex@0.147.0

# uid 1000 so the vault bind mount is writable without root owning the notes,
# matching the backend container and the host user. The node image already
# holds that uid, so the user is renamed rather than added: a second passwd
# entry on the same uid would leave `whoami` and `$HOME` answering for whichever
# one comes first in the file.
RUN usermod --login kasten --home /home/kasten --move-home node \
    && groupmod --new-name kasten node

USER kasten
WORKDIR /vault
ENV TERM=xterm-256color

# No EXPOSE. The container is reached over the `web` network by name, and
# publishing a port would put a root-less but unauthenticated shell on the box.
#
# The command ends at `-s` with no session name. `-a` appends the client's
# `?arg=` fragments after the server's own argv, so `?arg=agent-kasten` runs
# `tmux new -A -s agent-kasten`. A name here would push the client's name into
# the next slot, which tmux reads as the command to run in the session.
#
# `-W` is not optional: ttyd has been read-only by default since 1.7.0, and
# without it the terminal looks alive and drops every keystroke.
CMD ["ttyd", "-W", "-a", "-b", "/term", "-p", "7681", "tmux", "new", "-A", "-s"]
