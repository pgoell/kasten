#!/bin/sh
# Give the uid a passwd line if it has none, seed herdr's config and the commit
# identity into the home volume once, install Claude Code there if it is
# missing, then hand over to ttyd.
#
# The config cannot live in the image. herdr rewrites that file whenever you
# change a setting in its own UI, and an image path is root-owned and read-only
# to the user this runs as, so every save failed. It cannot simply be made
# writable either: a file written into the image layer is thrown away by the
# next rebuild, which is a setting that saves and then silently reverts.
#
# So the image copy is a default rather than something herdr tracks. It is
# written to the volume only when nothing is there, which means your saved
# settings survive a rebuild and a changed `shell/herdr.toml` reaches only a
# fresh volume. Edit the file in place inside the container to change a running
# one.
set -e

# Compose runs this as KASTEN_UID, which need not be the image's own 1000. A
# uid with no line in /etc/passwd has no name, and node's os.userInfo() throws
# for it, which an agent built on node can trip over at any point. nss_wrapper
# hands every process started from here a passwd file with that uid in it, in
# place of the real one, so nothing in the image has to be writable for it.
# Making /etc/passwd itself writable would let the user add a uid 0 line and
# `su` to it. uid 1000 is in the real file and takes none of this.
if ! getent passwd "$(id -u)" >/dev/null; then
    export NSS_WRAPPER_PASSWD=/tmp/passwd
    export NSS_WRAPPER_GROUP=/etc/group
    grep -v '^kasten:' /etc/passwd > "${NSS_WRAPPER_PASSWD}"
    echo "kasten:x:$(id -u):$(id -g)::${HOME}:/usr/bin/zsh" >> "${NSS_WRAPPER_PASSWD}"
    export LD_PRELOAD=/usr/local/lib/libnss_wrapper.so
fi

# A volume made under one uid and then run under another is owned by the
# first. Every step below writes to it, so say so here rather than fail on
# whichever of them comes first. The top of a fresh volume is open to every
# uid, so herdr's directory, which the first start makes and herdr writes its
# sockets into, is what tells whose volume it is.
herdr_dir="${HOME}/.config/herdr"
if [ ! -w "${HOME}" ] || { [ -d "${herdr_dir}" ] && [ ! -w "${herdr_dir}" ]; }; then
    echo "kasten-shell: the home volume is not writable by uid $(id -u). Give it to that uid, or run as the uid that owns it." >&2
    exit 1
fi

config="${HOME}/.config/herdr/config.toml"
if [ ! -f "${config}" ]; then
    mkdir -p "$(dirname "${config}")"
    cp /etc/herdr/config.toml.default "${config}"
fi

# zsh runs its new-user wizard when the home holds no startup file at all,
# which over a browser terminal looks like a shell that will not take a
# command. Seeding one also gives you a place in the volume for your own
# aliases; the shared ones are in /etc/zsh/zshrc.kasten, which the image owns
# and a rebuild replaces.
zshrc="${HOME}/.zshrc"
if [ ! -f "${zshrc}" ]; then
    echo '# Yours. The shared setup is /etc/zsh/zshrc.kasten, read before this.' > "${zshrc}"
fi

# Who a commit made in here is by. Each value comes from JJ_USER or JJ_EMAIL
# and is written only where nothing is set yet, so a name set by hand inside
# the container is never replaced by the environment. Both land in the home
# volume and outlive a rebuild. jj is asked from $HOME rather than /vault: the
# question is the user config, and inside a repo it would read the repo's too.
# git gets the same pair because the vault's jj repo is colocated, and a
# `git commit` here would otherwise stop and ask.
set_identity() {
    key="$1"
    value="$2"
    [ -n "${value}" ] || return 0
    # jj's built-in defaults set both keys to "", so an unset one reads back
    # empty and succeeds; the test is on the value, not the exit code.
    if [ -z "$(cd "${HOME}" && jj config get "${key}" 2>/dev/null)" ]; then
        (cd "${HOME}" && jj config set --user "${key}" "${value}")
    fi
    if [ -z "$(git config --global --get "${key}")" ]; then
        git config --global "${key}" "${value}"
    fi
}

# jj reads JJ_USER and JJ_EMAIL itself, ahead of every config file. Left in
# the environment they would win over the config check below and over any name
# set later by hand, so they are taken out first and only seed the config.
jj_user="${JJ_USER:-}"
jj_email="${JJ_EMAIL:-}"
unset JJ_USER JJ_EMAIL
set_identity user.name "${jj_user}"
set_identity user.email "${jj_email}"

# Claude Code is Anthropic's proprietary software, so the published image does
# not carry it. It is installed here instead, into the home volume, by
# Anthropic's own installer and under Anthropic's terms, once: the binary lands
# in ~/.local/bin, which the Dockerfile puts on PATH, and `claude update`
# replaces it in place, so an update outlives a release. Only when no `claude`
# is found, so a volume that has one is never touched.
#
# The script is fetched to a file rather than piped to bash: a failed curl
# piped in hands bash nothing, and bash reports that as success. The timeout
# keeps a stalled download from holding the shell back for good. A failure
# here is printed and passed over, since a shell without Claude Code is still
# a shell; the next start tries again.
if ! command -v claude >/dev/null; then
    echo "kasten-shell: installing Claude Code into ${HOME}/.local/bin (first start only)" >&2
    installer="$(mktemp)"
    if curl -fsSL --max-time 60 -o "${installer}" https://claude.ai/install.sh \
        && timeout 600 bash "${installer}" >&2; then
        echo "kasten-shell: Claude Code installed" >&2
    else
        echo "kasten-shell: Claude Code could not be installed (no network?). The shell starts without it; restart the container to try again." >&2
    fi
    rm -f "${installer}"
fi

exec "$@"
