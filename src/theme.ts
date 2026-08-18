import {
	S_BAR,
	S_BAR_END,
	S_BAR_H,
	S_BAR_START,
	S_CONNECT_LEFT,
	S_STEP_SUBMIT,
	unicodeOr,
} from "@clack/prompts";

/**
 * The template's visual language.
 *
 * Nothing in this module is configurable by consumers beyond {@link Accent}.
 * That is the entire point of the package: the look is decided here, once, so
 * every flow built with onboard-kit is consistent and good without the
 * developer making a single visual decision.
 */

/** The six permitted accents. Deliberately not free-form colour. */
export type Accent = "cyan" | "green" | "magenta" | "blue" | "yellow" | "violet";

const ACCENT_CODES: Record<Accent, string> = {
	cyan: "36",
	green: "32",
	magenta: "35",
	blue: "34",
	yellow: "33",
	violet: "95",
};

const ESC = "\x1b[";

function colorEnabled(): boolean {
	const env = process.env;
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
	if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
	return Boolean(process.stdout.isTTY);
}

function wrap(code: string, text: string): string {
	return colorEnabled() ? `${ESC}${code}m${text}${ESC}0m` : text;
}

export const dim = (text: string): string => wrap("2", text);
export const bold = (text: string): string => wrap("1", text);
export const red = (text: string): string => wrap("31", text);
export const green = (text: string): string => wrap("32", text);
export const yellow = (text: string): string => wrap("33", text);

/**
 * Rail glyphs come from clack so our chrome and its prompts line up exactly.
 *
 * Result marks do not: clack's `S_SUCCESS`/`S_ERROR` are prompt *state*
 * markers (`◆`/`■`) that collide with the step glyph when stacked in a check
 * list. Ticks and crosses read as pass/fail at a glance, so we define our own.
 */
export const SYM = {
	bar: S_BAR,
	barStart: S_BAR_START,
	barEnd: S_BAR_END,
	barH: S_BAR_H,
	connect: S_CONNECT_LEFT,
	step: S_STEP_SUBMIT,
	pass: unicodeOr("\u2714", "+"),
	warn: unicodeOr("\u25b2", "!"),
	fail: unicodeOr("\u2718", "x"),
	pointer: unicodeOr("\u276f", ">"),
} as const;

const HEADER_WIDTH = 48;

export interface Theme {
	readonly accent: (text: string) => string;
	/** `┌  Name ────────` — opens the rail. */
	header(name: string): string;
	/** `├  Title ────────` — a divider that keeps the rail connected. */
	divider(title: string): string;
	/** `└  message` — closes the rail. */
	footer(message: string): string;
	/** A bare rail segment, for vertical rhythm between blocks. */
	rail(text?: string): string;
	/** `◇  label` — a completed template-owned step. */
	step(label: string): string;
	/** An indented status line beneath a step. */
	status(kind: "pass" | "warn" | "fail", text: string): string;
	/** Aligned `key   value` rows for the review table. */
	rows(entries: readonly (readonly [string, string])[]): string;
	/** The trailing `Next` block. */
	next(entries: readonly (readonly [string, string])[]): string;
}

export function createTheme(accent: Accent): Theme {
	const paint = (text: string) => wrap(ACCENT_CODES[accent], text);

	function rule(prefix: string, title: string): string {
		// Rule length is computed from the *visible* title, never the styled string.
		const used = 3 + title.length + 1;
		const fill = Math.max(HEADER_WIDTH - used, 0);
		return `${prefix}  ${bold(title)} ${dim(SYM.barH.repeat(fill))}`;
	}

	return {
		accent: paint,
		header: (name) => rule(paint(SYM.barStart), name),
		divider: (title) => rule(dim(SYM.connect), title),
		footer: (message) => `${paint(SYM.barEnd)}  ${message}`,
		rail: (text) => (text === undefined ? dim(SYM.bar) : `${dim(SYM.bar)}  ${text}`),
		step: (label) => `${paint(SYM.step)}  ${label}`,
		status: (kind, text) => {
			const mark = kind === "pass" ? green(SYM.pass) : kind === "warn" ? yellow(SYM.warn) : red(SYM.fail);
			return `${dim(SYM.bar)}  ${mark}  ${kind === "warn" ? dim(text) : text}`;
		},
		rows: (entries) => {
			const width = entries.reduce((max, [key]) => Math.max(max, key.length), 0);
			return entries.map(([key, value]) => `${dim(SYM.bar)}  ${key.padEnd(width)}   ${value}`).join("\n");
		},
		next: (entries) => {
			const width = entries.reduce((max, [cmd]) => Math.max(max, cmd.length), 0);
			const lines = entries.map(([cmd, desc]) => `      ${paint(cmd.padEnd(width))}   ${dim(desc)}`);
			return [`    ${bold("Next")}`, ...lines].join("\n");
		},
	};
}
