/**
 * /copy — 把某条助手回复复制到系统剪贴板
 *
 * 用法：
 *   /copy           弹出选择列表（最新在前），回车复制整条回复
 *   /copy last      直接复制最近一条回复
 *   /copy 3         复制倒数第 3 条回复
 *
 * 相关内置功能（不用本扩展也行）：
 *   Ctrl+X          复制最后一条助手回复（fullscreen 下有选区时复制选区）
 *   /tree + Ctrl+X  在树里选中任意消息后复制该消息
 *
 * 剪贴板优先走 pi 内置 native clipboard，失败则退回 wl-copy / xsel。
 */
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getNativeClipboard } from "@earendil-works/pi-tui";

interface Reply {
	n: number; // 倒数序号，1 = 最新
	text: string;
	time: string;
}

interface MessageLike {
	role: string;
	content?: Array<{ type: string; text?: string }>;
}

function collectReplies(getBranch: () => Array<{ type: string; message?: unknown; timestamp?: string }>): Reply[] {
	const replies: Reply[] = [];
	for (const entry of getBranch()) {
		if (entry.type !== "message") continue;
		const message = entry.message as MessageLike | undefined;
		if (!message || message.role !== "assistant") continue;
		const text = (message.content ?? [])
			.filter((b) => b.type === "text" && b.text && b.text.trim())
			.map((b) => b.text as string)
			.join("\n\n")
			.trim();
		if (!text) continue;
		replies.push({
			n: replies.length + 1,
			text,
			time: (entry.timestamp ?? "").slice(11, 16),
		});
	}
	return replies;
}

async function copyViaCommand(cmd: string[], text: string): Promise<boolean> {
	try {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
			child.on("error", reject);
			child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
			child.stdin.end(text);
		});
		return true;
	} catch {
		return false;
	}
}

async function copyText(text: string): Promise<boolean> {
	const clipboard = getNativeClipboard();
	if (clipboard?.setText) {
		try {
			await clipboard.setText(text);
			return true;
		} catch {
			// fall through to command-line tools
		}
	}
	if (await copyViaCommand(["wl-copy"], text)) return true;
	if (await copyViaCommand(["xsel", "--clipboard", "--input"], text)) return true;
	return false;
}

function preview(reply: Reply, total: number): string {
	const first = (reply.text.split("\n").find((l) => l.trim()) ?? "")
		.replace(/[*_`>#-]/g, "")
		.trim()
		.slice(0, 48);
	return `${String(total - reply.n + 1).padStart(2)}  ${reply.time}  ${first}  (${reply.text.length} 字)`;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("copy", {
		description: "复制某条助手回复到剪贴板（/copy 选择 · /copy last 最新 · /copy N 倒数第N条）",
		handler: async (args, ctx) => {
			const replies = collectReplies(() => ctx.sessionManager.getBranch());
			if (replies.length === 0) {
				ctx.ui.notify("本会话还没有可复制的助手回复", "warning");
				return;
			}

			const arg = (args ?? "").trim();
			let chosen: Reply | undefined;

			if (arg === "") {
				if (!ctx.hasUI) {
					ctx.ui.notify("当前模式不支持交互选择，请用 /copy last 或 /copy N", "warning");
					return;
				}
				const options = replies.map((r) => preview(r, replies.length)).reverse(); // 最新在前
				const picked = await ctx.ui.select("复制哪条回复？（最新在前）", options);
				if (!picked) return;
				const n = replies.length - Number(picked.trim().split(/\s+/)[0]) + 1;
				chosen = replies.find((r) => r.n === n);
			} else if (/^\d+$/.test(arg)) {
				chosen = replies.find((r) => r.n === Number(arg));
			} else if (arg.toLowerCase() === "last" || arg === "最新") {
				chosen = replies[replies.length - 1];
			} else {
				ctx.ui.notify("用法：/copy · /copy last · /copy N", "warning");
				return;
			}

			if (!chosen) {
				ctx.ui.notify(`没有找到第 ${arg} 条回复（共 ${replies.length} 条）`, "warning");
				return;
			}
			const ok = await copyText(chosen.text);
			ctx.ui.notify(
				ok ? `已复制第 ${chosen.n} 条回复（${chosen.text.length} 字）` : "复制失败：未找到可用的剪贴板工具",
				ok ? "info" : "error",
			);
		},
	});
}
