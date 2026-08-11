#!/usr/bin/env bash
# Register this box as a self-hosted GitHub Actions runner for kasten and keep
# it running. Needs no sudo: the runner is a systemd user unit, and lingering
# is already enabled for this account so it survives logout and reboot.
#
# Runners are per repository for a user account, so the Klassenzeit and website
# runners on this box cannot serve kasten. This adds a third.
#
# docs/how-to/deploy-to-the-vps.md documents the system-service alternative if
# you would rather match the other two.
set -euo pipefail

cd "$(dirname "$0")/.."

RUNNER_DIR="$HOME/actions-runner-kasten"
RUNNER_NAME="iuno-kasten"
UNIT_NAME="actions-runner-kasten"
UNIT_PATH="$HOME/.config/systemd/user/${UNIT_NAME}.service"

# --- Preflight ---------------------------------------------------------------
command -v gh >/dev/null || { echo "gh is required; install https://cli.github.com/" >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated; run 'gh auth login'" >&2; exit 3; }
command -v systemctl >/dev/null || { echo "systemctl is required" >&2; exit 2; }

OWNER_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner) || {
  echo "could not resolve the repo; run this from a kasten checkout" >&2
  exit 4
}

# Reuse the tarball the other runners were installed from. The runner
# self-updates, so an older archive is fine.
TARBALL=$(ls -1t "$HOME"/actions-runner/actions-runner-linux-x64-*.tar.gz 2>/dev/null | head -1) || true
if [[ -z "${TARBALL:-}" ]]; then
  echo "no runner tarball under ~/actions-runner/." >&2
  echo "download one from https://github.com/actions/runner/releases and retry." >&2
  exit 5
fi

echo "repo:    $OWNER_REPO"
echo "runner:  $RUNNER_NAME"
echo "dir:     $RUNNER_DIR"
echo

# --- Unpack ------------------------------------------------------------------
if [[ -f "$RUNNER_DIR/config.sh" ]]; then
  echo "→ runner already unpacked, skipping extract"
else
  echo "→ unpacking $(basename "$TARBALL")"
  mkdir -p "$RUNNER_DIR"
  tar xzf "$TARBALL" -C "$RUNNER_DIR"
fi

# --- Register ----------------------------------------------------------------
if [[ -f "$RUNNER_DIR/.runner" ]]; then
  echo "→ already registered, skipping"
  echo "  to re-register: systemctl --user stop $UNIT_NAME && cd $RUNNER_DIR && ./config.sh remove --token \$(gh api -X POST /repos/$OWNER_REPO/actions/runners/remove-token --jq .token)"
else
  echo "→ registering with $OWNER_REPO"
  # The registration token is one-shot and expires in about an hour, so it is
  # minted in the same command that consumes it and never written to disk.
  (cd "$RUNNER_DIR" && ./config.sh \
    --url "https://github.com/$OWNER_REPO" \
    --token "$(gh api -X POST "/repos/$OWNER_REPO/actions/runners/registration-token" --jq .token)" \
    --name "$RUNNER_NAME" \
    --labels self-hosted,Linux,X64 \
    --unattended --replace)
fi

# --- Keep it running ---------------------------------------------------------
echo "→ installing the systemd user unit"
mkdir -p "$(dirname "$UNIT_PATH")"
cat > "$UNIT_PATH" <<UNIT
[Unit]
Description=GitHub Actions runner (kasten)
After=network-online.target

[Service]
ExecStart=%h/actions-runner-kasten/run.sh
WorkingDirectory=%h/actions-runner-kasten
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"

# --- Verify ------------------------------------------------------------------
echo "→ waiting for the runner to report online"
for _ in $(seq 1 20); do
  status=$(gh api "/repos/$OWNER_REPO/actions/runners" \
    --jq ".runners[] | select(.name==\"$RUNNER_NAME\") | .status" 2>/dev/null || true)
  if [[ "$status" == "online" ]]; then
    echo
    echo "✔ $RUNNER_NAME is online. Publish a GitHub release to deploy production."
    exit 0
  fi
  sleep 3
done

echo >&2
echo "✖ runner did not come online within 60s" >&2
echo "  logs: journalctl --user -u $UNIT_NAME -n 50" >&2
exit 1
