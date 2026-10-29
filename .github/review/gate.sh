#!/usr/bin/env bash
# The Human gate: passes a low-risk pull request, and holds a high-risk one
# until pgoell adds the `approved` label to its latest commit. High risk is a
# path on risk-paths or a `hold` label. A push takes the label off again, so an
# approval holds for the commits pgoell saw.
#
# Reads PR, EVENT, OWNER, ENFORCE and GH_TOKEN from the environment.
set -euo pipefail

repo=$GITHUB_REPOSITORY
here=$(dirname "$0")

labels() { gh api "repos/$repo/issues/$PR/labels" --jq '.[].name'; }

if [ "$EVENT" = synchronize ] && labels | grep -qx approved; then
  gh api -X DELETE "repos/$repo/issues/$PR/labels/approved" >/dev/null
fi

mapfile -t globs < <(grep -vE '^\s*(#|$)' "$here/risk-paths")
mapfile -t files < <(gh api --paginate "repos/$repo/pulls/$PR/files" --jq '.[].filename')

hits=()
for f in "${files[@]}"; do
  for g in "${globs[@]}"; do
    # shellcheck disable=SC2053 # the glob is meant to match
    if [[ $f == $g ]]; then hits+=("$f"); break; fi
  done
done

current=$(labels)
held=false
if grep -qx hold <<<"$current"; then held=true; fi

approved=false
if grep -qx approved <<<"$current"; then
  # Only the owner's label counts: anyone with triage rights can add one.
  by=$(gh api --paginate "repos/$repo/issues/$PR/events" \
    --jq '.[] | select(.event == "labeled" and .label.name == "approved") | .actor.login' | tail -1)
  if [ "$by" = "$OWNER" ]; then approved=true; fi
fi

{
  echo "## Human gate"
  if [ ${#hits[@]} -eq 0 ] && [ "$held" = false ]; then
    echo "Low risk: no path on risk-paths and no \`hold\` label. Merges without $OWNER."
  else
    echo "High risk. Needs the \`approved\` label from $OWNER on the latest commit."
    if [ "$held" = true ]; then echo "- labelled \`hold\`"; fi
    for f in "${hits[@]}"; do echo "- \`$f\`"; done
    echo
    echo "Approved: $approved."
  fi
  if [ "$ENFORCE" != true ]; then echo; echo "Pilot: this check reports and blocks nothing."; fi
} >>"$GITHUB_STEP_SUMMARY"

if [ "$ENFORCE" = true ] && { [ ${#hits[@]} -gt 0 ] || [ "$held" = true ]; } && [ "$approved" = false ]; then
  echo "High risk and not approved by $OWNER: see the summary." >&2
  exit 1
fi
