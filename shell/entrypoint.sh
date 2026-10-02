#!/bin/sh
# Seed herdr's config and the commit identity into the home volume, once, then
# hand over to ttyd.
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

exec "$@"
