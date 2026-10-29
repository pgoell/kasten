#!/usr/bin/env bash
# Writes .review/context.md: the pull request's title and body, and the earlier
# review threads, keeping only comments by this workflow's bot and the owner.
# Anyone may comment on a public pull request; a stranger's comment must not
# reach the reviewer as if it were part of the task.
#
# Reads PR, OWNER and GH_TOKEN from the environment.
set -euo pipefail

mkdir -p .review
trusted="[\"github-actions[bot]\", \"$OWNER\"]"
{
  gh api "repos/$GITHUB_REPOSITORY/pulls/$PR" \
    --jq "if (.user.login | IN(${trusted}[])) then \"# \" + .title + \"\n\n\" + (.body // \"\") else \"# \" + .title end"
  echo
  echo "## Earlier review threads"
  gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$PR/comments" \
    --jq ".[] | select(.user.login | IN(${trusted}[])) | \"\n### \" + .path + \":\" + ((.line // .original_line) | tostring) + \" (\" + .user.login + \")\n\" + .body"
} >.review/context.md
