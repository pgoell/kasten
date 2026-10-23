---
type: Reference
title: HTML theme contract
description: How an HTML page in the vault opts in to kasten's theme, what kasten adds to such a page, the messages that carry a theme switch, the fallback layer for a file opened outside kasten, what a page may and may not do, how to check one, and the token table.
resource: backend/src/kasten_backend/page_theme.py
tags: [frontend, backend, design, html]
status: draft
---

# HTML theme contract

A page opts in with one tag in its `<head>`:

```html
<meta name="kasten-theme" content="tokens">
```

## The rules

- May: any layout, any token anywhere, `color-mix(in srgb, var(--k-warn) 14%, transparent)` for tints, SVG with `currentColor` or `var(--k-*)`, page-local variables that point to tokens, `prefers-reduced-motion`.
- May not: hex, rgb or named colours outside the fallback layer. Loading fonts or naming font families. Setting `data-theme` or reading the system theme inside Kasten. Redefining `--k-*` outside the fallback layer. Fixing the page height or catching Space, `?` or Escape. Fixed bars over the top of the page. Styling `::highlight(kasten-taken)` or `::selection`, or stopping `mouseup` and `selectionchange`. Using `y` as a shortcut while text is selected. `localStorage`, cookies or calls to the vault.
- How to check a page: switch the theme half way down, scroll stays. Open the file directly in light and dark system mode. Grep the CSS for `#`, `rgb(` and quoted `font-family` outside the layer.
