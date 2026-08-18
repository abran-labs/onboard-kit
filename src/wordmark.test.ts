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
		const glyphChars = new Set(wordmark("Onboard Kit 42").join("").split(""));
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
		expect(wordmark("I", "*").join("")).not.toContain("█");
		expect(wordmark("I", "*").join("")).toContain("*");
	});
});
