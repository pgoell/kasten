#!/usr/bin/env bash
# Writes .review/context.md: the pull request's title and body, the issues it
# closes or is part of, and the earlier review threads, keeping only text by
# this workflow's bot and the owner.
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
  # The reviewer checks the change against the task, so it needs the task
  # itself and not only the author's account of it in the body.
  for n in $(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR" --jq '.body // ""' |
    grep -oiE '(closes|fixes|resolves|part of) #[0-9]+' | grep -oE '[0-9]+' | sort -u); do
    echo
    gh api "repos/$GITHUB_REPOSITORY/issues/$n" \
      --jq "if (.user.login | IN(${trusted}[])) then \"## Issue #$n: \" + .title + \"\n\n\" + (.body // \"\") else \"## Issue #$n (by someone else, not shown)\" end"
  done
  echo
  echo "## Earlier review threads"
  gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$PR/comments" \
    --jq ".[] | select(.user.login | IN(${trusted}[])) | \"\n### \" + .path + \":\" + ((.line // .original_line) | tostring) + \" (\" + .user.login + \")\n\" + .body"
  # Design, Pre-existing and Nit findings live in the summaries, not in threads.
  echo
  echo "## Earlier summaries"
  gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$PR/comments" \
    --jq '.[] | select(.user.login == "github-actions[bot]") | select(.body | startswith("**Review**") or startswith("**Security**")) | "\n" + .body'
} >.review/context.md
