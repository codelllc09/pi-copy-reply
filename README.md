**English** · [简体中文](./README.zh-CN.md)

# pi-copy-reply

Copy any past assistant reply to the system clipboard.

Pi's built-in `Ctrl+X` and `/copy` (Pi 1.4+) both copy the *last* reply; pulling
an older one out of a long session meant navigating `/tree`. This tiny extension
adds a picker over recent replies — Enter copies the whole message.

## Usage

```
/copy-reply     open a picker (newest first, with time / first-line preview /
               char count); Enter copies the full reply
/copy-reply last  copy the most recent reply
/copy-reply 3     copy the 3rd-most-recent reply
```

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

0BSD — do whatever you want, no attribution required.
