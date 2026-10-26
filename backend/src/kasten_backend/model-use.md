---
type: Reference
title: Model use prices and projects
---

# Model use prices and projects

Prices are Anthropic's list prices in US dollars per million tokens, read 2026-10-26 from https://platform.claude.com/docs/en/about-claude/pricing.

Each row holds input, output, cache write 5m, cache write 1h and cache read, in that order. A `fast` row prices fast-mode messages, and an `over N` row prices messages whose prompt is above N tokens.

## Prices
- claude-fable-5-1: input 10, output 50, cache write 5m 12.5, cache write 1h 20, cache read 0.25
- claude-fable-5: input 10, output 50, cache write 5m 12.5, cache write 1h 20, cache read 1
- claude-opus-5-5: input 4, output 20, cache write 5m 5, cache write 1h 8, cache read 0.2
- claude-opus-5-5 fast: input 8, output 40, cache write 5m 10, cache write 1h 16, cache read 0.4
- claude-opus-5: input 5, output 25, cache write 5m 6.25, cache write 1h 10, cache read 0.5
- claude-opus-5 fast: input 10, output 50, cache write 5m 12.5, cache write 1h 20, cache read 1
- claude-opus-4-8: input 5, output 25, cache write 5m 6.25, cache write 1h 10, cache read 0.5
- claude-opus-4-8 fast: input 10, output 50, cache write 5m 12.5, cache write 1h 20, cache read 1
- claude-opus-4-7: input 5, output 25, cache write 5m 6.25, cache write 1h 10, cache read 0.5
- claude-opus-4-6: input 5, output 25, cache write 5m 6.25, cache write 1h 10, cache read 0.5
- claude-opus-4-5: input 5, output 25, cache write 5m 6.25, cache write 1h 10, cache read 0.5
- claude-sonnet-5-5: input 2, output 10, cache write 5m 2.5, cache write 1h 4, cache read 0.1
- claude-sonnet-5: input 2, output 10, cache write 5m 2.5, cache write 1h 4, cache read 0.2
- claude-sonnet-4-6: input 3, output 15, cache write 5m 3.75, cache write 1h 6, cache read 0.3
- claude-sonnet-4-5: input 3, output 15, cache write 5m 3.75, cache write 1h 6, cache read 0.3
- claude-haiku-5-5: input 0.1, output 0.5, cache write 5m 0.125, cache write 1h 0.2, cache read 0.01
- claude-haiku-5-5 over 100000: input 0.5, output 2.5, cache write 5m 0.625, cache write 1h 1, cache read 0.05
- claude-haiku-4-5: input 1, output 5, cache write 5m 1.25, cache write 1h 2, cache read 0.1

## Projects

A folder that no line here names counts under its last folder name. To map a folder to a project, add a line such as `- /home/me/Code/kasten: kasten` to a copy of this note at `<config>/model-use.md` in the vault.
