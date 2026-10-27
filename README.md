# pi-copy-reply

把任意一条历史助手回复复制到系统剪贴板。

Pi 内置的 `Ctrl+X` 只能复制**最后一条**回复；要从几十轮对话里捞一条旧的，
只能进 `/tree` 选中再复制。这个小扩展补上这个缺口：弹出最近回复的预览列表，
回车即整条复制。

## 用法

```
/copy          弹出选择列表（最新在前，显示时间/首行预览/字数），回车复制整条
/copy last     直接复制最近一条
/copy 3        复制倒数第 3 条
```

- 剪贴板优先走 pi 内置 native clipboard，失败自动退回 `wl-copy` / `xsel`
- 复制的是**原始 Markdown**（含代码块、列表语法），不是渲染后的屏幕文本
- 无依赖、无配置

## 安装

```bash
pi install git:github.com/codelllc09/pi-copy-reply
```

或试运行一次：

```bash
pi -e git:github.com/codelllc09/pi-copy-reply
```

## License

0BSD — 随便用，不用署名。

---

**English** — Copy any past assistant reply to the system clipboard.
Pi's built-in `Ctrl+X` only copies the *last* reply; this adds a picker over
recent replies (plus `/copy last` / `/copy N`). Copies raw Markdown via the
native clipboard with `wl-copy`/`xsel` fallback. Zero dependencies. 0BSD.
