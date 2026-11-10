---
type: Reference
title: GitHub settings
description: The three settings that switch on the year and week review's GitHub section, what each does, and where the cache of read days lives.
resource: backend/src/kasten_backend/github.py
tags: [config, github, review, environment]
status: stable
---

# GitHub settings

The year and week review draws a GitHub section from the contributions of one
user. These three settings say whose, with which token, and where the days read
so far are kept. [Configuration](/reference/configuration.md) lists every other
setting.

## KASTEN_GITHUB_USER

The GitHub login whose contributions the review draws.

| | |
| --- | --- |
| Default | unset, which turns the review's GitHub section off |
| Read by | `GET /api/github` |

Set it together with [`KASTEN_GITHUB_TOKEN`](#kasten_github_token). Without
both, the review says GitHub is off and the backend never asks GitHub. The
login is not sent to the browser.

## KASTEN_GITHUB_TOKEN

A token that may read the contributions of `KASTEN_GITHUB_USER`.

| | |
| --- | --- |
| Default | unset, which turns the review's GitHub section off |
| Read by | `GET /api/github` |

The backend sends it to GitHub's GraphQL API in the `Authorization` header and
nowhere else. It is never sent to the browser, never written to a log and never
put in an error. A settings dump shows it masked.

GitHub's GraphQL API takes no read without a token, but it needs no scope for
public contributions. A classic personal access token with no scope ticked
reads the contributions in public repositories. With the `read:user` scope it
also reads those in private and internal repositories, which GitHub's
[`contributionsCollection`](https://docs.github.com/en/graphql/reference/users)
counts only under that scope. Both are free. Try the token with no scope first
and add `read:user` only if private work should count.

## KASTEN_GITHUB_CACHE_PATH

Where the GitHub contributions read so far are kept.

| | |
| --- | --- |
| Default | `github-contributions.json` beside the tokens file |
| Read by | `GET /api/github` |

Each day read is kept in this one JSON file, with the login it was read for, the
time GitHub was last asked, and which days are settled. A day read on a later
day than itself is settled and is answered from the file for good. Any other
day, today among them, is read again once the last read is an hour old. A file
holding another login is ignored. A failed read answers the days the file holds.

Like the tokens file, it lies outside the vault, so a count never enters jj
history. Production mounts the directory that holds the tokens, which keeps the
file across a restart with no change to the deploy.
