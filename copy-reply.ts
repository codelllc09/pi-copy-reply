/**
 * /copy — copy a past assistant reply to the system clipboard
 *
 * Usage:
 *   /copy           open a picker over recent replies (newest first, with
 *                   time / first-line preview / char count); Enter copies
 *   /copy last      copy the most recent reply directly
 *   /copy 3         copy the 3rd-most-recent reply
 *
 * Related built-ins (work without this extension):
 *   Ctrl+X          copy the last assistant reply (or the active selection)
 *   /tree + Ctrl+X  copy any selected message from the session tree
 *
 * Clipboard: prefers Pi's native clipboard helper, falls back to
 * wl-copy / xsel. Copies raw Markdown (code fences, lists), not the
 * rendered screen text.
 */
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getNativeClipboard } from "@earendil-works/pi-tui";

interface Reply {
	n: number; // 1-based index from the oldest reply
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
	return `${String(total - reply.n + 1).padStart(2)}  ${reply.time}  ${first}  (${reply.text.length} chars)`;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("copy", {
		description: "Copy an assistant reply to the clipboard (/copy picker · /copy last · /copy N)",
		handler: async (args, ctx) => {
			const replies = collectReplies(() => ctx.sessionManager.getBranch());
			if (replies.length === 0) {
				ctx.ui.notify("No assistant replies to copy yet", "warning");
				return;
			}

			const arg = (args ?? "").trim();
			let chosen: Reply | undefined;

			if (arg === "") {
				if (!ctx.hasUI) {
					ctx.ui.notify("Interactive picker unavailable here; use /copy last or /copy N", "warning");
					return;
				}
				const options = replies.map((r) => preview(r, replies.length)).reverse(); // newest first
				const picked = await ctx.ui.select("Copy which reply? (newest first)", options);
				if (!picked) return;
				const n = replies.length - Number(picked.trim().split(/\s+/)[0]) + 1;
				chosen = replies.find((r) => r.n === n);
			} else if (/^\d+$/.test(arg)) {
				chosen = replies.find((r) => r.n === Number(arg));
			} else if (arg.toLowerCase() === "last") {
				chosen = replies[replies.length - 1];
			} else {
				ctx.ui.notify("Usage: /copy · /copy last · /copy N", "warning");
				return;
			}

			if (!chosen) {
				ctx.ui.notify(`No reply #${arg} (found ${replies.length} replies)`, "warning");
				return;
			}
			const ok = await copyText(chosen.text);
			ctx.ui.notify(
				ok ? `Copied reply #${chosen.n} (${chosen.text.length} chars)` : "Copy failed: no clipboard tool found",
				ok ? "info" : "error",
			);
		},
	});
}
