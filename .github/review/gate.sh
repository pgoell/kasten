#!/usr/bin/env bash
# The Human gate: passes a low-risk pull request, and holds a high-risk one
# until pgoell adds the `approved` label to its latest commit. High risk is a
# path on risk-paths or a `hold` label. A push takes the label off again, so an
# approval holds for the commits pgoell saw.
#
# It reports as a commit status on the head commit, read at run time, not as
# this job's check: a `pull_request_target` run's check does not sit on the pull
# request's head, and a status does, so a new push starts pending.
#
# Reads PR, EVENT, HEAD_SHA, OWNER, ENFORCE and GH_TOKEN from the environment.
set -euo pipefail

repo=$GITHUB_REPOSITORY
here=$(dirname "$0")

labels() { gh api "repos/$repo/issues/$PR/labels" --jq '.[].name'; }

if [ "$EVENT" = synchronize ] && labels | grep -qx approved; then
  gh api -X DELETE "repos/$repo/issues/$PR/labels/approved" >/dev/null
fi

mapfile -t globs < <(grep -vE '^\s*(#|$)' "$here/risk-paths")
# A rename counts from both ends, so moving a file off a risky path is risky.
mapfile -t files < <(gh api --paginate "repos/$repo/pulls/$PR/files" --jq '.[] | .filename, (.previous_filename // empty)')
head=$(gh api "repos/$repo/pulls/$PR" --jq .head.sha)
# A run whose event a newer push has passed would judge the new commit by old
# labels and files; the run for that push owns its status.
if [ "$head" != "$HEAD_SHA" ]; then
  echo "The head moved on to $head; the run for that push decides." >>"$GITHUB_STEP_SUMMARY"
  exit 0
fi

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

state=success
desc="Low risk"
if [ ${#hits[@]} -gt 0 ] || [ "$held" = true ]; then
  if [ "$approved" = true ]; then
    desc="High risk, approved by $OWNER"
  else
    desc="High risk: waits for the approved label from $OWNER"
    if [ "$ENFORCE" = true ]; then state=failure; else desc="Pilot, would block. $desc"; fi
  fi
fi
gh api "repos/$repo/statuses/$head" -f state="$state" -f context="Human gate" \
  -f description="${desc:0:140}" \
  -f target_url="$GITHUB_SERVER_URL/$repo/actions/runs/$GITHUB_RUN_ID" >/dev/null
