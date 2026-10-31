**English** · [简体中文](./docs/README.zh-CN.md)

# pi-copy-reply

Copy the final reply of any past turn to the system clipboard.

Pi's built-in `Ctrl+X` and `/copy` (Pi 1.4+) copy the *last* message, and
`/tree` + `Ctrl+X` reaches any single message. What had no shortcut was a
turn's final answer — the reply the agent hands back after its tool calls.
This tiny extension adds a picker over recent turns; Enter copies the
highlighted turn's final reply (mid-turn progress notes are skipped).

## Usage

```
/copy-reply     open a picker (newest first): list pane + live preview of the
               highlighted turn; Enter copies its final reply
/copy-reply last  copy the final reply of the most recent turn
/copy-reply 3     copy the final reply of the 3rd-most-recent turn
```

Picker keys: `↑↓`/`PgUp/PgDn` move · `Enter` copy · `v` full view
(scrollable, keeps blank lines and indentation) · `Esc` cancel/back. Mouse:
wheel moves (or scrolls in full view), click selects, double-click copies.
Numbering is "1 = newest" everywhere — picker rows, `/copy-reply N`, and
`last` all agree. On Pi versions without `ctx.ui.custom()` the picker falls
back to a plain one-line list.

- Copies **raw Markdown** (code fences, lists), not rendered screen text
- Prefers Pi's native clipboard helper; falls back to `wl-copy` / `xsel`
- Zero dependencies, zero configuration

## Install

```bash
pi install npm:pi-copy-reply
```

Or try it once without installing:

```bash
pi -e git:github.com/codelllc09/pi-copy-reply
```

## License

MIT — see [LICENSE](./LICENSE).
