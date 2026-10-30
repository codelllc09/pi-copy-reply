/**
 * /copy-reply — copy a past assistant reply to the system clipboard
 * (named /copy-reply since Pi 1.4 added a built-in /copy for the last message)
 *
 * Usage:
 *   /copy-reply     open a picker over recent replies (newest first): list
 *                   pane + live multi-line preview of the highlighted reply,
 *                   Enter copies
 *   /copy-reply last  copy the most recent reply directly
 *   /copy-reply 3     copy the 3rd-most-recent reply directly
 *
 * Picker (two-pane overlay, docked above the editor like Pi's native select):
 *   - list pane: one row per reply (index / time / chars / first-line peek),
 *     windowed beyond 6 rows
 *   - preview pane: the highlighted reply's actual content, wrapped and dim;
 *     "v" opens a scrollable full view (blank lines and indentation kept)
 *   - keys: ↑↓/PgUp/PgDn move · Enter copy · v full view · Esc cancel/back
 *   - mouse: wheel moves (or scrolls in full view), click selects,
 *     double-click copies — fullscreen mode only
 *   - falls back to a plain ctx.ui.select list on Pi versions without
 *     ctx.ui.custom()
 *
 * Numbering is "1 = newest" everywhere (picker rows, /copy-reply N, last).
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
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	getNativeClipboard,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";

interface Reply {
	n: number; // 1-based index from the newest reply
	text: string;
	time: string; // "HH:MM" ("" when the entry has no timestamp)
}

interface MessageLike {
	role: string;
	content?: Array<{ type: string; text?: string }>;
}

/** Session-branch entry shape we read (kept loose: Pi owns the real type). */
export interface BranchEntry {
	type: string;
	message?: unknown;
	timestamp?: string;
}

/** Collect assistant replies from a session branch, newest-first numbering. */
export function collectReplies(getBranch: () => BranchEntry[]): Reply[] {
	const found: Array<{ text: string; time: string }> = [];
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
		found.push({ text, time: (entry.timestamp ?? "").slice(11, 16) });
	}
	// Newest first; number 1 = newest so picker rows and /copy-reply N agree.
	found.reverse();
	return found.map((r, i) => ({ n: i + 1, ...r }));
}

/** First non-empty line as a one-line peek: leading Markdown markers and
 * paired emphasis stripped (hyphens inside words survive), whitespace
 * collapsed, hard-capped. */
export function firstLine(text: string, cap = 60): string {
	const first = text.split("\n").find((l) => l.trim()) ?? "";
	return first
		.replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, "")
		.replace(/(\*\*?|__?|`{1,3})(.+?)\1/g, "$2")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, cap);
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

/** Row label shared by the overlay list and the plain-select fallback:
 * index, time, char count, first-line peek. */
function labelOf(reply: Reply): string {
	const meta = `${String(reply.n).padStart(2)} ${reply.time || "     "} ${String(reply.text.length).padStart(6)}c`;
	return `${meta}  ${firstLine(reply.text)}`;
}

/** Plain-select fallback for Pi versions without ctx.ui.custom(). */
async function pickReplyFallback(ctx: ExtensionContext, replies: Reply[]): Promise<Reply | undefined> {
	const labels = replies.map(labelOf); // newest first
	const picked = await ctx.ui.select("Copy which reply? (newest first)", labels);
	if (picked === undefined) return undefined;
	return replies[labels.indexOf(picked)]; // identity by position, not label parsing
}

// ---- Two-pane overlay picker (list below, live preview above) ----

const LIST_ROWS = 6; // list pane height (windowed when more replies)
const PREVIEW_ROWS = 9; // preview pane height in list mode
/** Full view grows the preview by the rows the collapsed list gives back
 * (the list keeps exactly one row), so the window height never jumps. */
const FULL_ROWS = PREVIEW_ROWS + LIST_ROWS - 1;

/**
 * Pick a reply with a live preview. Layout mirrors pi-quote-blocks' manager:
 * preview pane floating above a list pane docked like the native selector,
 * title in the top border, section label on the separator, hints at the
 * bottom. Fixed pane heights — moving the cursor only recolors one row and
 * swaps preview text in place. "v" expands the preview to a scrollable full
 * view (raw text: blank lines and indentation kept).
 */
function pickReply(ctx: ExtensionContext, replies: Reply[]): Promise<Reply | undefined> {
	const customFn: ExtensionUIContext["custom"] | undefined = (ctx.ui as Partial<ExtensionUIContext>).custom;
	if (!customFn) return pickReplyFallback(ctx, replies);
	return customFn<Reply | undefined>(
		(tui, theme, keybindings, done) => {
			let view: "list" | "full" = "list";
			let index = 0; // selection (0 = newest)
			let scrollOffs = 0; // full-view scroll offset
			let currentWidth = 72; // width memo: render is the only place that knows it
			let cacheKey: string | undefined;
			let cachedLines: string[] | undefined;
			let peekCache: { key: string; lines: string[] } | undefined; // preview: non-empty lines
			let fullCache: { key: string; lines: string[] } | undefined; // full view: raw lines

			const innerFor = (w: number): number => Math.max(10, w - 4);
			const invalidate = () => {
				cacheKey = undefined;
				cachedLines = undefined;
			};

			/** Wrapped non-empty lines for the peek (blank lines are noise there). */
			function peekLines(reply: Reply): string[] {
				const key = `${currentWidth}:${reply.n}`;
				if (peekCache?.key === key) return peekCache.lines;
				const lines = reply.text
					.split("\n")
					.filter((l) => l.trim())
					.flatMap((l) => wrapTextWithAnsi(l, innerFor(currentWidth)));
				peekCache = { key, lines };
				return lines;
			}

			/** Wrapped raw lines for the full view — indentation and blanks kept. */
			function fullLines(reply: Reply): string[] {
				const key = `${currentWidth}:${reply.n}`;
				if (fullCache?.key === key) return fullCache.lines;
				const lines = reply.text
					.split("\n")
					.flatMap((l) => (l.length ? wrapTextWithAnsi(l, innerFor(currentWidth)) : [""]));
				fullCache = { key, lines };
				return lines;
			}

			/** First visible row of the list window (keeps the cursor centered). */
			const listStart = (): number =>
				replies.length <= LIST_ROWS
					? 0
					: Math.max(0, Math.min(index - (LIST_ROWS >> 1), replies.length - LIST_ROWS));

			return {
				render(w: number): string[] {
					currentWidth = w;
					const key = `${w}:${view}:${index}:${scrollOffs}`;
					if (cachedLines && cacheKey === key) return cachedLines;

					const inner = innerFor(w);
					const pad = (line: string): string => {
						const clipped = truncateToWidth(line, inner, "…");
						return `│ ${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))} │`;
					};
					const borderRow = (
						left: string,
						right: string,
						label: string,
						style?: (t: string) => string,
					): string => {
						const text = style ? style(label) : label;
						// clip first so over-long labels (narrow windows) never
						// overflow; the fill then lands the right corner exactly
						// on the content edge
						const clipped = truncateToWidth(text, Math.max(1, w - 5), "…");
						const fill = Math.max(1, w - 3 - visibleWidth(clipped));
						return `${left}─${clipped}${"─".repeat(fill)}${right}`;
					};

					// ─ preview pane (floating above the list) ─
					const reply = replies[index];
					const rawLineCount = reply.text.split("\n").length;
					const previewRows: string[] = [];
					let sectionLabel: string;
					if (view === "list") {
						const head = `❝ #${reply.n} · ${reply.time || "--:--"} · ${reply.text.length} chars · ${rawLineCount} line${rawLineCount === 1 ? "" : "s"}`;
						const budget = PREVIEW_ROWS - 2; // head + possible truncation hint
						const peek = peekLines(reply).slice(0, budget);
						previewRows.push(theme.fg("accent", head), ...peek.map((l) => theme.fg("dim", l)));
						if (peekLines(reply).length > budget) {
							previewRows.push(theme.fg("dim", "… more · v for full view"));
						}
						while (previewRows.length < PREVIEW_ROWS) previewRows.push("");
						sectionLabel = " pick a reply (newest first) ";
					} else {
						const all = fullLines(reply);
						scrollOffs = Math.max(0, Math.min(scrollOffs, Math.max(0, all.length - FULL_ROWS)));
						const shown = all.slice(scrollOffs, scrollOffs + FULL_ROWS);
						previewRows.push(...shown.map((l) => theme.fg("dim", l)));
						while (previewRows.length < FULL_ROWS) previewRows.push("");
						const end = Math.min(scrollOffs + FULL_ROWS, all.length);
						sectionLabel = ` full view · lines ${scrollOffs + 1}–${end} of ${all.length} `;
					}

					// ─ list pane (docked like the native selector) ─
					const listRows: string[] = [];
					if (view === "list") {
						const start = listStart();
						const windowRows = Math.min(LIST_ROWS, replies.length);
						for (let i = start; i < start + windowRows; i++) {
							const cursor = i === index ? "❯ " : "  ";
							const color = i === index ? theme.fg("accent", labelOf(replies[i])) : theme.fg("dim", labelOf(replies[i]));
							listRows.push(pad(`${cursor}${color}`));
						}
					} else {
						listRows.push(pad(`❯ ${theme.fg("accent", labelOf(reply))}`));
					}
					while (listRows.length < LIST_ROWS) listRows.push(pad(""));

					// ─ window chrome ─
					const windowStart = listStart();
					const shownCount = Math.min(LIST_ROWS, replies.length);
					const title =
						view === "full"
							? " ❐ copy-reply · full view "
							: replies.length > LIST_ROWS
								? ` ❐ copy-reply · ${windowStart + 1}–${windowStart + shownCount} of ${replies.length} `
								: ` ❐ copy-reply · ${replies.length} ${replies.length === 1 ? "reply" : "replies"} `;
					const hints =
						view === "list"
							? " ↑↓ move · Enter copy · v full view · Esc cancel "
							: " ↑↓ scroll · v/Esc back · Enter copy ";

					cachedLines = [
						borderRow("╭", "╮", title, (t) => theme.fg("accent", t)),
						...previewRows.map((row) => pad(row)),
						borderRow("├", "┤", sectionLabel, (t) => theme.fg("dim", t)),
						...listRows,
						borderRow("╰", "╯", hints, (t) => theme.fg("dim", t)),
					];
					cacheKey = key;
					return cachedLines;
				},

				handleInput(data: string): void {
					const up = keybindings.matches(data, "tui.select.up");
					const down = keybindings.matches(data, "tui.select.down");
					const pageUp = keybindings.matches(data, "tui.select.pageUp");
					const pageDown = keybindings.matches(data, "tui.select.pageDown");
					if (keybindings.matches(data, "tui.select.cancel")) {
						if (view === "full") {
							view = "list";
						} else {
							done(undefined);
							return;
						}
					} else if (keybindings.matches(data, "tui.select.confirm")) {
						done(replies[index]);
						return;
					} else if (up || down || pageUp || pageDown) {
						if (view === "list") {
							const step = up ? -1 : down ? 1 : pageUp ? -5 : 5;
							index = Math.max(0, Math.min(replies.length - 1, index + step));
						} else {
							const page = Math.max(1, FULL_ROWS >> 1);
							const step = up ? -1 : down ? 1 : pageUp ? -page : page;
							const maxOffs = Math.max(0, fullLines(replies[index]).length - FULL_ROWS);
							scrollOffs = Math.max(0, Math.min(maxOffs, scrollOffs + step));
						}
					} else if (data.length === 1 && data.toLowerCase() === "v") {
						view = view === "list" ? "full" : "list";
						scrollOffs = 0;
					} else {
						return;
					}
					invalidate();
					tui.requestRender();
				},

				handleMouse(event: TuiMouseEvent): { handled: boolean } | undefined {
					if (event.type === "wheel") {
						const lines = event.wheelDelta ?? 0; // negative = up (pi-tui convention)
						const step = Math.sign(lines) * Math.max(1, Math.abs(lines));
						if (view === "list") {
							index = Math.max(0, Math.min(replies.length - 1, index + step)); // wheel: +down/−up (pi-tui scrollBy convention)
						} else {
							const maxOffs = Math.max(0, fullLines(replies[index]).length - FULL_ROWS);
							scrollOffs = Math.max(0, Math.min(maxOffs, scrollOffs + step));
						}
						invalidate();
						tui.requestRender();
						return { handled: true };
					}
					if (view !== "list" || event.button !== "left") return undefined;
					if (event.type !== "click" && event.type !== "press") return undefined;
					// Component-local rows: top border + preview pane + separator.
					const firstRow = 1 + PREVIEW_ROWS + 1;
					const row = event.y - firstRow;
					const windowRows = Math.min(LIST_ROWS, replies.length);
					if (row < 0 || row >= windowRows) return undefined;
					const target = listStart() + row;
					if ((event.clickCount ?? 1) >= 2) {
						done(replies[target]);
						return { handled: true };
					}
					index = target;
					invalidate();
					tui.requestRender();
					return { handled: true };
				},

				invalidate,
			};
		},
		{
			overlay: true,
			overlayOptions: { anchor: "bottom-center", width: "60%", minWidth: 46, maxHeight: 24, margin: 4 },
		},
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("copy-reply", {
		description: "Copy a past assistant reply to the clipboard (/copy-reply picker · /copy-reply last · /copy-reply N = nth-newest)",
		handler: async (args, ctx) => {
			const replies = collectReplies(() => ctx.sessionManager.getBranch());
			if (replies.length === 0) {
				ctx.ui.notify("No assistant replies to copy yet", "warning");
				return;
			}

			const arg = (args ?? "").trim();
			let chosen: Reply | undefined;

			if (arg === "") {
				if (!ctx.hasUI || ctx.mode !== "tui") {
					ctx.ui.notify("Interactive picker unavailable here; use /copy-reply last or /copy-reply N", "warning");
					return;
				}
				chosen = await pickReply(ctx, replies);
			} else if (/^\d+$/.test(arg)) {
				chosen = replies.find((r) => r.n === Number(arg));
				if (!chosen) {
					ctx.ui.notify(`Only ${replies.length} replies in this session (1 = newest)`, "warning");
					return;
				}
			} else if (arg.toLowerCase() === "last") {
				chosen = replies[0];
			} else {
				ctx.ui.notify("Usage: /copy-reply · /copy-reply last · /copy-reply N (1 = newest)", "warning");
				return;
			}

			if (!chosen) return; // picker cancelled
			const ok = await copyText(chosen.text);
			ctx.ui.notify(
				ok ? `Copied reply #${chosen.n} (${chosen.text.length} chars)` : "Copy failed: no clipboard tool found",
				ok ? "info" : "error",
			);
		},
	});
}
