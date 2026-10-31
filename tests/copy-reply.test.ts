import { describe, expect, it } from "vitest";
import { collectReplies, firstLine, type BranchEntry } from "../copy-reply";

/** A session message entry (real shape: every message is type "message"). */
function msg(role: string, content: Array<{ type: string; text?: string }>, timestamp?: string): BranchEntry {
	return { type: "message", message: { role, content }, ...(timestamp ? { timestamp } : {}) };
}

/** Build a branch with one turn per text, oldest-first, plus noise. */
function branch(...texts: string[]): BranchEntry[] {
	const entries: BranchEntry[] = [{ type: "session_start" }];
	for (const [i, text] of texts.entries()) {
		entries.push(msg("user", [{ type: "text", text }]));
		entries.push(
			msg("assistant", [{ type: "text", text }], `2026-10-0${(i % 9) + 1}T0${i}:${10 + i}:00Z`),
		);
	}
	return entries;
}

describe("collectReplies", () => {
	it("numbers 1 = newest and orders newest-first", () => {
		const replies = collectReplies(() => branch("oldest", "middle", "newest"));
		expect(replies.map((r) => r.n)).toEqual([1, 2, 3]);
		expect(replies.map((r) => r.text)).toEqual(["newest", "middle", "oldest"]);
	});

	it("extracts HH:MM from the timestamp", () => {
		const replies = collectReplies(() => [msg("assistant", [{ type: "text", text: "hi" }], "2026-10-01T14:32:00Z")]);
		expect(replies[0]?.time).toBe("14:32");
	});

	it("keeps empty timestamps as empty strings", () => {
		const replies = collectReplies(() => [msg("assistant", [{ type: "text", text: "hi" }])]);
		expect(replies[0]?.time).toBe("");
	});

	it("joins multiple text blocks with blank lines and skips empty ones", () => {
		const replies = collectReplies(() => [
			msg("assistant", [
				{ type: "text", text: "" },
				{ type: "text", text: "a" },
				{ type: "tool_use", text: "ignored" },
				{ type: "text", text: "b" },
			]),
		]);
		expect(replies[0]?.text).toBe("a\n\nb");
	});

	it("ignores non-assistant and non-message entries", () => {
		expect(collectReplies(() => branch())).toEqual([]);
	});

	it("keeps only the last text of a turn — mid-turn progress is not a reply", () => {
		const replies = collectReplies(() => [
			msg("user", [{ type: "text", text: "go" }]),
			msg("assistant", [{ type: "thinking", text: "hmm" }, { type: "text", text: "progress A" }], "2026-10-01T10:00:00Z"),
			msg("toolResult", [{ type: "text", text: "output" }]),
			msg("assistant", [{ type: "text", text: "final B" }], "2026-10-01T10:05:00Z"),
		]);
		expect(replies).toEqual([{ n: 1, text: "final B", time: "10:05" }]);
	});

	it("falls back to an earlier text when the turn ends without one", () => {
		// e.g. aborted mid-thinking after an earlier text message
		const replies = collectReplies(() => [
			msg("user", [{ type: "text", text: "go" }]),
			msg("assistant", [{ type: "text", text: "partial answer" }], "2026-10-01T10:00:00Z"),
			msg("assistant", [{ type: "tool_use", text: "call" }]),
			msg("assistant", [{ type: "thinking", text: "interrupted" }]),
		]);
		expect(replies).toEqual([{ n: 1, text: "partial answer", time: "10:00" }]);
	});

	it("emits at most one reply per turn, across turns", () => {
		const replies = collectReplies(() => [
			msg("user", [{ type: "text", text: "first" }]),
			msg("assistant", [{ type: "text", text: "A1" }]),
			msg("assistant", [{ type: "text", text: "A2" }], "2026-10-01T11:00:00Z"),
			msg("user", [{ type: "text", text: "second" }]),
			msg("assistant", [{ type: "thinking", text: "hmm" }]),
			msg("assistant", [{ type: "text", text: "B1" }], "2026-10-01T12:00:00Z"),
		]);
		expect(replies).toEqual([
			{ n: 1, text: "B1", time: "12:00" },
			{ n: 2, text: "A2", time: "11:00" },
		]);
	});

	it("skips turns that produced no text at all", () => {
		const replies = collectReplies(() => [
			msg("user", [{ type: "text", text: "go" }]),
			msg("assistant", [{ type: "thinking", text: "hmm" }]),
			msg("toolResult", [{ type: "text", text: "out" }]),
			msg("user", [{ type: "text", text: "again" }]),
			msg("assistant", [{ type: "text", text: "ok" }]),
		]);
		expect(replies).toEqual([{ n: 1, text: "ok", time: "" }]);
	});
});

describe("firstLine", () => {
	it("takes the first non-empty line, stripped of Markdown emphasis", () => {
		expect(firstLine("  \n## **Fixed** the `cache` bug\nbody")).toBe("Fixed the cache bug");
	});

	it("strips list and quote markers but keeps hyphens inside words", () => {
		expect(firstLine("- one-liner stays")).toBe("one-liner stays");
		expect(firstLine("> quoted reply")).toBe("quoted reply");
		expect(firstLine("3. numbered item")).toBe("numbered item");
	});

	it("collapses whitespace runs", () => {
		expect(firstLine("a   b\t\tc")).toBe("a b c");
	});

	it("caps the peek length", () => {
		expect(firstLine("x".repeat(100), 10)).toBe("xxxxxxxxxx");
	});

	it("returns empty for blank text", () => {
		expect(firstLine(" \n\n ")).toBe("");
	});
});
