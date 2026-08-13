#!/bin/sh
# Seed herdr's config into the home volume, once, then hand over to ttyd.
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

exec "$@"
