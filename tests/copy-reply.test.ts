import { describe, expect, it } from "vitest";
import { collectReplies, firstLine, type BranchEntry } from "../copy-reply";

/** Build a branch with one assistant reply per text, oldest-first, plus noise. */
function branch(...texts: string[]): BranchEntry[] {
	const entries: BranchEntry[] = [{ type: "session_start" }];
	for (const [i, text] of texts.entries()) {
		entries.push({ type: "user_message", message: { role: "user", content: [] } });
		entries.push({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text }] },
			timestamp: `2026-10-0${(i % 9) + 1}T0${i}:${10 + i}:00Z`,
		});
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
		const replies = collectReplies(() => [
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] }, timestamp: "2026-10-01T14:32:00Z" },
		]);
		expect(replies[0]?.time).toBe("14:32");
	});

	it("keeps empty timestamps as empty strings", () => {
		const replies = collectReplies(() => [
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
		]);
		expect(replies[0]?.time).toBe("");
	});

	it("joins multiple text blocks with blank lines and skips empty ones", () => {
		const replies = collectReplies(() => [
			{
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "" }, { type: "text", text: "a" }, { type: "tool_use", text: "ignored" }, { type: "text", text: "b" }] },
			},
		]);
		expect(replies[0]?.text).toBe("a\n\nb");
	});

	it("ignores non-assistant and non-message entries", () => {
		expect(collectReplies(() => branch())).toEqual([]);
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
