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

/**
 * The six permitted accents. Deliberately named slots, not free-form colour:
 * each maps to an ANSI code the reader's terminal resolves from their own
 * palette, so it can never clash with their background.
 */
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

/**
 * Wraps text in an SGR pair.
 *
 * The closer is the specific reset for that attribute (`39` for colour, `22`
 * for weight), never `0`. A blanket reset would end any style it was nested
 * inside, so `dim()` within a coloured span would silently drop the colour —
 * and it is what clack emits, so our output stays byte-comparable with its.
 */
function wrap(open: string, close: string, text: string): string {
	return colorEnabled() ? `${ESC}${open}m${text}${ESC}${close}m` : text;
}

const color = (code: string) => (text: string) => wrap(code, "39", text);

export const dim = (text: string): string => wrap("2", "22", text);
/**
 * The rail colour.
 *
 * Bright black (SGR 90), not dim (SGR 2). Clack renders its own rail with 90,
 * and the two render visibly differently — mixing them made the vertical line
 * appear to change brightness as it ran down the screen.
 */
export const gray = color("90");
export const bold = (text: string): string => wrap("1", "22", text);
export const red = color("31");
export const green = color("32");
export const yellow = color("33");

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

/**
 * Builds the template's renderer.
 *
 * Colour policy: **hue belongs to status, weight belongs to chrome.**
 *
 * Anything reporting the state of something gets colour — a completed step and
 * a passing check are green, a warning yellow, a failure red. Anything that is
 * merely framing gets none: the rail is grey, and the title and `Next`
 * commands are bold rather than tinted, so brand styling never competes with
 * the status marks for the eye.
 *
 * Every colour is an ANSI slot, never fixed RGB, so the output is drawn from
 * the reader's own terminal palette and cannot clash with their background.
 *
 * `accent` is opt-in. Left undefined the chrome is entirely monochrome; set
 * it and exactly two places take colour — the title and the `Next` commands.
 */
export function createTheme(accent?: Accent): Theme {
	const paint = accent ? color(ACCENT_CODES[accent]) : (text: string) => text;

	function rule(prefix: string, title: string): string {
		// Rule length is computed from the *visible* title, never the styled string.
		const used = 3 + title.length + 1;
		const fill = Math.max(HEADER_WIDTH - used, 0);
		return `${prefix}  ${bold(paint(title))} ${gray(SYM.barH.repeat(fill))}`;
	}

	return {
		accent: paint,
		// The rail is frame, not content: every corner and join is the same grey
		// as the bar itself, and accent never touches it.
		header: (name) => rule(gray(SYM.barStart), name),
		divider: (title) => rule(gray(SYM.connect), title),
		footer: (message) => `${gray(SYM.barEnd)}  ${message}`,
		rail: (text) => (text === undefined ? gray(SYM.bar) : `${gray(SYM.bar)}  ${text}`),
		// Green matches clack's own submitted-step symbol, so our steps and its
		// prompts are indistinguishable in the same column.
		step: (label) => `${green(SYM.step)}  ${label}`,
		status: (kind, text) => {
			const mark = kind === "pass" ? green(SYM.pass) : kind === "warn" ? yellow(SYM.warn) : red(SYM.fail);
			return `${gray(SYM.bar)}  ${mark}  ${kind === "warn" ? dim(text) : text}`;
		},
		rows: (entries) => {
			const width = entries.reduce((max, [key]) => Math.max(max, key.length), 0);
			return entries.map(([key, value]) => `${gray(SYM.bar)}  ${key.padEnd(width)}   ${value}`).join("\n");
		},
		next: (entries) => {
			const width = entries.reduce((max, [cmd]) => Math.max(max, cmd.length), 0);
			// Bold carries these when no accent is set, so they still stand out.
			const lines = entries.map(([cmd, desc]) => `      ${bold(paint(cmd.padEnd(width)))}   ${dim(desc)}`);
			return [`    ${bold("Next")}`, ...lines].join("\n");
		},
	};
}
