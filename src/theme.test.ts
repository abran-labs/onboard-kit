import { beforeAll, describe, expect, test } from "bun:test";
import { createTheme } from "./theme.js";

/**
 * Locks the colour policy.
 *
 * The template's restraint is the product, so it needs a test: hue is spent
 * only on things that need attention, everything else is weight. A future
 * change that sprinkles colour back onto the chrome fails here.
 */

beforeAll(() => {
	// createTheme decides at call time, and tests have no TTY.
	process.env.FORCE_COLOR = "1";
});

/** Extracts the SGR codes from a styled string, in order. */
function codes(text: string): string[] {
	return [...text.matchAll(/\x1b\[(\d+)m/g)].map((m) => m[1] as string);
}

const RAIL = "90";
const RESET_COLOR = "39";
const BOLD = "1";
const DIM = "2";
const RESET_WEIGHT = "22";
const YELLOW = "33";
const RED = "31";

/** Every colour we ever emit, so an unexpected hue is caught by name. */
const HUES = ["31", "32", "33", "34", "35", "36", "90", "95"];

describe("colour policy", () => {
	const theme = createTheme();

	test("the rail is grey everywhere — bar, corners and joins alike", () => {
		expect(codes(theme.rail())).toEqual([RAIL, RESET_COLOR]);
		expect(codes(theme.header("MyTool"))[0]).toBe(RAIL);
		expect(codes(theme.divider("Review"))[0]).toBe(RAIL);
		expect(codes(theme.footer("Done"))[0]).toBe(RAIL);
	});

	test("a completed step carries no hue at all", () => {
		expect(codes(theme.step("Writing config"))).toEqual([]);
	});

	test("a passing check carries no hue — success is the expected case", () => {
		const hues = codes(theme.status("pass", "Node 20+")).filter((c) => c !== RAIL && c !== RESET_COLOR);
		expect(hues).toEqual([]);
	});

	test("only warnings and failures spend colour", () => {
		expect(codes(theme.status("warn", "git missing"))).toContain(YELLOW);
		expect(codes(theme.status("fail", "Node too old"))).toContain(RED);
	});

	test("without an accent the chrome is monochrome — weight only", () => {
		const rendered = [
			theme.header("MyTool"),
			theme.step("Step"),
			theme.status("pass", "ok"),
			theme.rows([["Provider", "OpenAI"]]),
			theme.next([["mytool start", "launch"]]),
		].join("\n");

		const unexpected = codes(rendered).filter((c) => HUES.includes(c) && c !== RAIL);
		expect(unexpected).toEqual([]);
		// Hierarchy still exists, carried by weight rather than hue.
		expect(codes(rendered)).toContain(BOLD);
		expect(codes(rendered)).toContain(DIM);
	});

	test("an accent colours exactly two things: the title and the Next commands", () => {
		const accented = createTheme("magenta");
		const MAGENTA = "35";

		expect(codes(accented.header("MyTool"))).toContain(MAGENTA);
		expect(codes(accented.next([["mytool start", "launch"]]))).toContain(MAGENTA);

		// and nothing else
		expect(codes(accented.step("Step"))).not.toContain(MAGENTA);
		expect(codes(accented.status("pass", "ok"))).not.toContain(MAGENTA);
		expect(codes(accented.rail("value"))).not.toContain(MAGENTA);
		expect(codes(accented.footer("Done"))).not.toContain(MAGENTA);
	});
});

describe("escape hygiene", () => {
	const theme = createTheme("cyan");

	test("styles close with their specific reset, never a blanket 0", () => {
		const rendered = [
			theme.header("MyTool"),
			theme.rail("value"),
			theme.status("warn", "git missing"),
			theme.next([["mytool start", "launch"]]),
		].join("\n");

		// A blanket reset would end any style it was nested inside.
		expect(codes(rendered)).not.toContain("0");
		for (const c of codes(rendered)) expect([...HUES, BOLD, DIM, RESET_COLOR, RESET_WEIGHT]).toContain(c);
	});

	test("NO_COLOR strips every escape", () => {
		process.env.FORCE_COLOR = "";
		process.env.NO_COLOR = "1";
		const plain = createTheme("cyan");
		expect(codes(plain.header("MyTool"))).toEqual([]);
		expect(codes(plain.status("fail", "nope"))).toEqual([]);
		process.env.NO_COLOR = "";
		process.env.FORCE_COLOR = "1";
	});
});

describe("layout", () => {
	const theme = createTheme();

	test("rule width is computed from the visible title, not the styled string", () => {
		// Styled and unstyled must occupy the same number of visible columns.
		process.env.FORCE_COLOR = "1";
		const styled = theme.header("MyTool").replace(/\x1b\[\d+m/g, "");
		process.env.FORCE_COLOR = "";
		process.env.NO_COLOR = "1";
		const plain = createTheme().header("MyTool");
		process.env.NO_COLOR = "";
		process.env.FORCE_COLOR = "1";

		expect(styled).toBe(plain);
	});

	test("review rows align their values into one column", () => {
		process.env.NO_COLOR = "1";
		const rows = createTheme()
			.rows([
				["Provider", "OpenAI"],
				["A much longer label", "yes"],
			])
			.split("\n");
		process.env.NO_COLOR = "";

		const columnOf = (line: string, value: string) => line.indexOf(value);
		expect(columnOf(rows[0] as string, "OpenAI")).toBe(columnOf(rows[1] as string, "yes"));
	});
});
