import { beforeAll, describe, expect, test } from "bun:test";
import { wordmark, wordmarkCorner } from "./wordmark.js";

/** Strips SGR escape sequences, leaving only the visible glyphs. */
function plain(lines: readonly string[]): string[] {
	return lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
}

beforeAll(() => {
	// colorEnabled() reads process.env, which is global across test files —
	// force it on so this suite doesn't depend on execution order relative to
	// theme.test.ts's own NO_COLOR toggling.
	process.env.FORCE_COLOR = "1";
});

describe("wordmark", () => {
	test("row count depends on which letters are present", () => {
		// "an" — neither ascends nor descends — stays at the three body rows.
		expect(wordmark("an", { maxWidth: 200 })).toHaveLength(3);
		// "kit" — k and t both climb — gains the ascender row.
		expect(wordmark("kit", { maxWidth: 200 })).toHaveLength(4);
		// "gap" — g descends, no letter ascends — gains the descender row instead.
		expect(wordmark("gap", { maxWidth: 200 })).toHaveLength(4);
		// "big" — b ascends, g descends — both extra rows appear.
		expect(wordmark("big", { maxWidth: 200 })).toHaveLength(5);
	});

	test("is case-insensitive", () => {
		expect(wordmark("onboard")).toEqual(wordmark("ONBOARD"));
		expect(wordmark("Onboard")).toEqual(wordmark("onboard"));
	});

	test("draws with block characters, half blocks and shade fills only", () => {
		const glyphChars = new Set(plain(wordmark("onboard kit hazy jumbo squelch vwxyz", { maxWidth: 500 })).join(""));
		for (const ch of glyphChars) {
			expect([" ", "█", "▀", "▄", "▒", "░"]).toContain(ch);
		}
	});

	test("unsupported characters degrade to blanks rather than throwing", () => {
		// A logo is decoration; it must never be able to fail a setup flow.
		expect(() => wordmark("MyTool™ ©∆ 42.0!")).not.toThrow();
		expect(wordmark("MyTool™", { maxWidth: 200 }).length).toBeGreaterThan(0);
	});

	test("empty input yields nothing to draw", () => {
		expect(wordmark("")).toEqual([]);
	});

	test("accentCode colours ink pixels only, never the shadow fill", () => {
		const accented = wordmark("onboard", { accentCode: "35", maxWidth: 200 }).join("\n");
		const plainVersion = wordmark("onboard", { maxWidth: 200 }).join("\n");

		expect(accented).toContain("35");
		// The bold+accent ink combination always carries "1" alongside the accent.
		expect(accented).toContain("1;35");
		// A shadow-only mark (~ or ,) stands alone in grey — 90 with nothing else
		// riding along, never the accent code mixed into that same sequence.
		expect(accented).toMatch(/\x1b\[90m/);
		expect(accented).not.toMatch(/\x1b\[[^m]*90[^m]*35[^m]*m/);
		expect(accented).not.toMatch(/\x1b\[[^m]*35[^m]*90[^m]*m/);

		// Visible shape is identical either way — only colour differs.
		expect(plain([accented])).toEqual(plain([plainVersion]));
	});

	test("auto scale falls back to one cell when two would not fit", () => {
		const roomy = wordmark("onboard", { maxWidth: 200 });
		const snug = wordmark("onboard", { maxWidth: 40 });
		expect(plain(roomy)[0]!.length).toBeGreaterThan(plain(snug)[0]!.length);
		for (const line of plain(snug)) expect(line.length).toBeLessThanOrEqual(40);
	});

	test("draws nothing when even one cell per pixel would wrap", () => {
		// A wrapped logo looks broken; the caller falls back to a plain header.
		expect(wordmark("onboard", { maxWidth: 10 })).toEqual([]);
		expect(wordmark("a very long product name here", { maxWidth: 60 })).toEqual([]);
	});

	test("halfStep slides the letters up half a cell without clipping them", () => {
		const flat = wordmark("mytool", { scale: 1, maxWidth: 200 });
		const lifted = wordmark("mytool", { scale: 1, maxWidth: 200, halfStep: true });

		// Re-pairing one pixel later costs a row; it must never cost a pixel.
		expect(lifted).toHaveLength(flat.length + 1);
		const inkOf = (rows: readonly string[]) => plain(rows).join("").replace(/[^█▀▄▒░]/g, "").length;
		expect(inkOf(lifted)).toBeGreaterThanOrEqual(inkOf(flat));

		// Half a cell up means the top band is now bottom-halves only.
		expect(plain(lifted)[0]).not.toContain("█");
		expect(plain(lifted)[0]).toContain("▄");
	});

	test("wordmarkCorner places the frame corner at the top of the lift", () => {
		expect(wordmarkCorner(0)).toBe(0);
		expect(wordmarkCorner(2)).toBe(1);
		expect(wordmarkCorner(3)).toBe(2);
	});

	test("explicit scale bypasses the width check", () => {
		expect(wordmark("onboard", { scale: 1, maxWidth: 5 }).length).toBeGreaterThan(0);
	});
});
