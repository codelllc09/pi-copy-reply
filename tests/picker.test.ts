import { describe, expect, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piCopyReply from "../copy-reply";

// Pane heights mirror copy-reply.ts (LIST_ROWS / PREVIEW_ROWS). If the
// component's layout constants change, update these to match.
const LIST_ROWS = 6;
const PREVIEW_ROWS = 9;
const FULL_ROWS = PREVIEW_ROWS + LIST_ROWS - 1; // full-view preview height
const SEPARATOR = 1 + PREVIEW_ROWS; // list-mode separator row index
const SEPARATOR_FULL = 1 + FULL_ROWS; // full-view separator row index
const FIRST_LIST_ROW = 1 + PREVIEW_ROWS + 1; // top border + preview + separator

/** ANSI key sequences → the select action they normally trigger. */
const KEYMAP: Record<string, string> = {
	"\x1b[A": "tui.select.up",
	"\x1b[B": "tui.select.down",
	"\x1b[5~": "tui.select.pageUp",
	"\x1b[6~": "tui.select.pageDown",
	"\r": "tui.select.confirm",
	"\x1b": "tui.select.cancel",
};

const NEW = "#1 newest reply\n\nsecond paragraph about caching strategy.";
const OLD = "fixed the parser\n\n```ts\n    const x = deep.indent();\n```";

/**
 * Register the extension, invoke /copy-reply with a fake TUI context, and
 * return the mounted picker component. The fake custom() captures the
 * component the same way Pi's TUI would mount it.
 */
function mountPicker(...branchOldestFirst: string[]) {
	const notifies: string[] = [];
	let command: { handler: (args: string | undefined, ctx: ExtensionContext) => Promise<void> } | undefined;
	const pi = {
		registerCommand: (_name: string, def: { handler: (args: string | undefined, ctx: ExtensionContext) => Promise<void> }) => {
			command = def;
		},
	} as unknown as ExtensionAPI;
	piCopyReply(pi);

	let component: { render: (w: number) => string[]; handleInput: (d: string) => void; handleMouse?: (e: Record<string, unknown>) => unknown } | undefined;
	const ctx = {
		hasUI: true,
		mode: "tui",
		sessionManager: {
			getBranch: () =>
				branchOldestFirst.map((text, i) => ({
					type: "message",
					message: { role: "assistant", content: [{ type: "text", text }] },
					timestamp: `2026-10-01T1${i}:0${i}:00Z`,
				})),
		},
		ui: {
			notify: (msg: string, level: string) => notifies.push(`${level}: ${msg}`),
			custom: (factory: (tui: unknown, theme: unknown, keys: unknown, done: (r: unknown) => void) => { render: (w: number) => string[]; handleInput: (d: string) => void; handleMouse?: (e: Record<string, unknown>) => unknown }) => {
				component = factory(
					{ requestRender: () => {} }, // tui
					{ fg: (_c: string, t: string) => t }, // theme: pass-through
					{ matches: (data: string, action: string) => KEYMAP[data] === action }, // keybindings
					() => {}, // done
				);
				return new Promise<never>(() => {}); // never settles; we drive the component directly
			},
		},
	} as unknown as ExtensionContext;

	const handlerDone = command!.handler("", ctx);
	return { component: () => component!, notifies, handlerDone };
}

describe("picker overlay", () => {
	it("renders a framed two-pane layout with live preview", () => {
		const { component } = mountPicker(OLD, NEW);
		const lines = component().render(72);

		expect(lines).toHaveLength(1 + PREVIEW_ROWS + 1 + LIST_ROWS + 1);
		expect(lines[0]?.startsWith("╭")).toBe(true);
		expect(lines.at(-1)?.endsWith("╯")).toBe(true);
		// preview header + first content line show the highlighted (newest) reply
		expect(lines[1]).toContain("#1");
		expect(lines[2]).toContain("#1 newest reply");
		// separator, selected list row, hints
		expect(lines[SEPARATOR]).toContain("pick a reply");
		expect(lines[FIRST_LIST_ROW]).toContain("❯");
		expect(lines[FIRST_LIST_ROW + 1]).toContain("2"); // second row, not selected
		expect(lines.at(-1)).toContain("Enter copy");
	});

	it("moving the cursor swaps the previewed reply", () => {
		const { component } = mountPicker(OLD, NEW);
		const comp = component();
		comp.render(72);
		comp.handleInput("\x1b[B"); // down
		const lines = comp.render(72);
		expect(lines[1]).toContain("#2");
		expect(lines[2]).toContain("fixed the parser");
	});

	it("v opens a scrollable full view that keeps blanks and indentation", () => {
		const { component } = mountPicker(OLD, NEW);
		const comp = component();
		comp.render(72);
		comp.handleInput("\x1b[B"); // select #2 (the code reply)
		comp.handleInput("v");
		const lines = comp.render(72);
		// full view grows the preview by the rows the collapsed list gives back
		expect(lines).toHaveLength(1 + FULL_ROWS + 1 + LIST_ROWS + 1);
		expect(lines[SEPARATOR_FULL]).toContain("full view · lines 1–");
		expect(lines.join("\n")).toContain("    const x = deep.indent();");
		expect(lines.at(-1)).toContain("v/Esc back");
		// pageDown scrolls (clamped), v returns to the list view
		comp.handleInput("\x1b[6~");
		expect(comp.render(72)[SEPARATOR_FULL]).toMatch(/full view · lines \d+–\d+ of /);
		comp.handleInput("v");
		expect(comp.render(72)[SEPARATOR]).toContain("pick a reply");
	});

	it("Esc in full view goes back to the list", () => {
		const { component } = mountPicker(NEW);
		const comp = component();
		comp.render(72);
		comp.handleInput("v");
		comp.handleInput("\x1b"); // back to list, not cancel
		expect(comp.render(72)[SEPARATOR]).toContain("pick a reply");
	});

	it("mouse wheel moves the selection; click selects, double-click copies", () => {
		const { component } = mountPicker(OLD, NEW);
		const comp = component();
		expect(comp.handleMouse).toBeTypeOf("function");
		comp.render(72);
		// pi-tui convention: positive wheelDelta scrolls down (older), negative up
		comp.handleMouse!({ type: "wheel", button: "none", y: 0, wheelDelta: 1 });
		expect(comp.render(72)[1]).toContain("#2");
		comp.handleMouse!({ type: "wheel", button: "none", y: 0, wheelDelta: -1 });
		expect(comp.render(72)[1]).toContain("#1");
		// single press on row 0 selects it
		comp.handleMouse!({ type: "press", button: "left", y: FIRST_LIST_ROW, clickCount: 1 });
		expect(comp.render(72)[1]).toContain("#1");
		// double-click copies (calls done — here a no-op, just must not throw)
		expect(() =>
			comp.handleMouse!({ type: "click", button: "left", y: FIRST_LIST_ROW, clickCount: 2 }),
		).not.toThrow();
	});

	it("shows the truncation hint when the reply exceeds the peek budget", () => {
		const long = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
		const { component } = mountPicker(long);
		expect(component().render(72).join("\n")).toContain("v for full view");
	});
});

describe("plain-select fallback", () => {
	it("falls back to ctx.ui.select when custom() is unavailable", async () => {
		const picks: Array<{ title: string; options: string[] }> = [];
		let command: { handler: (args: string | undefined, ctx: ExtensionContext) => Promise<void> } | undefined;
		const pi = {
			registerCommand: (_n: string, def: { handler: (args: string | undefined, ctx: ExtensionContext) => Promise<void> }) => {
				command = def;
			},
		} as unknown as ExtensionAPI;
		piCopyReply(pi);
		const notifies: string[] = [];
		const ctx = {
			hasUI: true,
			mode: "tui",
			sessionManager: {
				getBranch: () => [
					{ type: "message", message: { role: "assistant", content: [{ type: "text", text: NEW }] }, timestamp: "2026-10-01T10:00:00Z" },
				],
			},
			ui: {
				notify: (m: string, l: string) => notifies.push(`${l}: ${m}`),
				select: async (title: string, options: string[]) => {
					picks.push({ title, options });
					return options[0];
				},
			},
		} as unknown as ExtensionContext;

		await command!.handler("", ctx);
		expect(picks).toHaveLength(1);
		expect(picks[0]!.title).toContain("newest first");
		expect(picks[0]!.options[0]).toMatch(/^ 1 10:00 +\d+c  #1 newest reply/);
		// the picked reply (by position) went to the clipboard step
		expect(notifies[0]).toMatch(/Copied reply #1|Copy failed/);
	});
});
