import { describe, expect, test } from "bun:test";
import { wordmark, WORDMARK_ROWS } from "./wordmark.js";

describe("wordmark", () => {
	test("renders five rows of equal-height glyphs", () => {
		const lines = wordmark("AB");
		expect(lines).toHaveLength(WORDMARK_ROWS);
		// Every row spans the same width, or letters would shear apart.
		expect(new Set(lines.map((l) => l.length)).size).toBeLessThanOrEqual(2);
	});

	test("is case-insensitive", () => {
		expect(wordmark("mytool")).toEqual(wordmark("MyTool"));
		expect(wordmark("MYTOOL")).toEqual(wordmark("mytool"));
	});

	test("draws with block characters and nothing else", () => {
		const glyphChars = new Set(wordmark("Onboard Kit 42", { maxWidth: 200 }).join("").split(""));
		expect([...glyphChars].sort()).toEqual([" ", "█"]);
	});

	test("handles digits, spaces and hyphens", () => {
		for (const text of ["onboard-kit", "ACME 2", "v1.0"]) {
			expect(wordmark(text)).toHaveLength(WORDMARK_ROWS);
		}
	});

	test("unknown characters degrade to blanks rather than throwing", () => {
		// A logo is decoration; it must never be able to fail a setup flow.
		expect(() => wordmark("MyTool™ ©∆")).not.toThrow();
		expect(wordmark("MyTool™")).toHaveLength(WORDMARK_ROWS);
	});

	test("empty input yields nothing to draw", () => {
		expect(wordmark("")).toEqual([]);
	});

	test("accepts a custom ink character", () => {
		expect(wordmark("I", { ink: "*" }).join("")).not.toContain("█");
		expect(wordmark("I", { ink: "*" }).join("")).toContain("*");
	});

	test("draws two cells per pixel, since a terminal cell is twice as tall as wide", () => {
		const wide = wordmark("I", { scale: 2 });
		const narrow = wordmark("I", { scale: 1 });
		expect(wide[0]?.length).toBe((narrow[0]?.length ?? 0) * 2);
	});

	test("auto scale falls back to one cell when two would not fit", () => {
		const roomy = wordmark("MyTool", { maxWidth: 200 });
		const snug = wordmark("MyTool", { maxWidth: 40 });
		expect(roomy[0]!.length).toBeGreaterThan(snug[0]!.length);
		for (const line of snug) expect(line.length).toBeLessThanOrEqual(40);
	});

	test("draws nothing when even one cell per pixel would wrap", () => {
		// Wrapped letterforms look broken; the caller falls back to a plain
		// header rule instead.
		expect(wordmark("MyTool", { maxWidth: 20 })).toEqual([]);
		expect(wordmark("A very long product name here", { maxWidth: 60 })).toEqual([]);
	});
});
