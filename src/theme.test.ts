import { beforeAll, describe, expect, test } from "bun:test";
import { createTheme } from "./theme.js";

/**
 * Locks the colour policy: hue belongs to status, weight belongs to chrome.
 *
 * Status marks are coloured because they report state. The rail, title and
 * `Next` commands are not, because they are framing — tinting them makes the
 * brand compete with the marks that actually mean something.
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
const GREEN = "32";
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

	test("status marks are coloured by what they report", () => {
		expect(codes(theme.step("Writing config"))).toContain(GREEN);
		expect(codes(theme.status("pass", "Node 20+"))).toContain(GREEN);
		expect(codes(theme.status("warn", "git missing"))).toContain(YELLOW);
		expect(codes(theme.status("fail", "Node too old"))).toContain(RED);
	});

	test("chrome carries no hue — the title and commands use weight instead", () => {
		const chrome = [
			theme.header("MyTool"),
			theme.rows([["Provider", "OpenAI"]]),
			theme.next([["mytool start", "launch"]]),
		].join("\n");

		// Grey rail aside, framing is never tinted.
		expect(codes(chrome).filter((c) => HUES.includes(c) && c !== RAIL)).toEqual([]);
		expect(codes(chrome)).toContain(BOLD);
		expect(codes(chrome)).toContain(DIM);
	});

	test("an accent colours exactly two things: the title and trailing commands", () => {
		const accented = createTheme("magenta");
		const MAGENTA = "35";

		expect(codes(accented.header("MyTool"))).toContain(MAGENTA);
		expect(codes(accented.next([["mytool start", "launch"]]))).toContain(MAGENTA);

		// and nothing else — status marks keep their own meaning
		expect(codes(accented.step("Step"))).not.toContain(MAGENTA);
		expect(codes(accented.status("pass", "ok"))).not.toContain(MAGENTA);
		expect(codes(accented.rail("value"))).not.toContain(MAGENTA);
		expect(codes(accented.footer("Done"))).not.toContain(MAGENTA);
	});

	test("the trailing command list has no heading", () => {
		const rendered = createTheme().next([["mytool start", "launch"]]);
		expect(rendered).not.toContain("Next");
		expect(rendered).toContain("mytool start");
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

describe("trailing blocks", () => {
	test("the resume block aligns its values and sits shallow", () => {
		process.env.NO_COLOR = "1";
		const lines = createTheme()
			.trailing([
				["Resume", "mytool setup --resume"],
				["Note", "credentials asked again"],
			])
			.split("\n");
		process.env.NO_COLOR = "";

		// Shallow indent: it follows a closed rail, not nested inside one.
		expect(lines[0]?.startsWith("   R")).toBe(true);
		expect(lines[0]?.indexOf("mytool")).toBe(lines[1]?.indexOf("credentials"));
	});

	test("a wordmark is rail content, and its first row opens the frame", () => {
		// It reads as *inside* the frame, not a banner floating above it — but
		// the corner costs no line of its own: row one rides the `┌`.
		process.env.NO_COLOR = "1";
		const theme = createTheme();
		const logoLines = theme.logo(["███", "█  "]).split("\n");
		process.env.NO_COLOR = "";
		expect(logoLines).toEqual(["┌  ███", "│  █  "]);
	});

	test("a corner row below zero lets the letters overhang the frame", () => {
		// Lifting the wordmark cannot clip it, so the rows it rises into carry
		// blank indent rather than rail — the corner joins partway down.
		process.env.NO_COLOR = "1";
		const lines = createTheme().logo(["aa", "bb", "cc", "dd"], 2).split("\n");
		process.env.NO_COLOR = "";
		expect(lines).toEqual(["   aa", "   bb", "┌  cc", "│  dd"]);
	});
});
