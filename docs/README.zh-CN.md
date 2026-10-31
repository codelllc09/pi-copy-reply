[English](../README.md) · **简体中文**

# pi-copy-reply

把任意一个历史回合的最终回复复制到系统剪贴板。

pi 内置的 `Ctrl+X` 与 `/copy`（pi 1.4+）复制的是最后一条消息，`/tree` +
`Ctrl+X` 能复制任意单条消息；唯独“一个回合的最终回答”没有快捷入口。
这个小扩展在最近的回合上弹出选择器——回车复制该回合的最终回复
（回合中途的进度播报自动跳过）。

## 用法

```
/copy-reply     弹出选择器（最新在前）：列表 + 高亮回合的实时预览，回车复制其最终回复
/copy-reply last  直接复制最近一个回合的最终回复
/copy-reply 3     复制倒数第 3 个回合的最终回复
```

选择器键位：`↑↓`/`PgUp/PgDn` 移动 · `Enter` 复制 · `v` 全文视图（可滚动，
保留空行与缩进）· `Esc` 取消/返回。鼠标：滚轮移动（全文视图内滚动），
单击选中，双击复制。序号统一“1 = 最新”——选择器行、`/copy-reply N`、
`last` 三处一致。旧版 pi 无 `ctx.ui.custom()` 时退回单行列表。

- 复制的是**原始 Markdown**（含代码块、列表语法），不是渲染后的屏幕文本
- 剪贴板优先走 pi 内置 native clipboard，失败自动退回 `wl-copy` / `xsel`
- 零依赖、零配置

## 安装

```bash
pi install npm:pi-copy-reply
```

或试运行一次（不写入配置）：

```bash
pi -e git:github.com/codelllc09/pi-copy-reply
```

## 许可证

MIT — 见 [LICENSE](../LICENSE)。
