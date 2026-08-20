import type { Writable } from "node:stream";
import { formatInstructionFooter, MULTISELECT_INSTRUCTIONS, SELECT_INSTRUCTIONS } from "@clack/prompts";
import type { Output } from "./run.js";
import { dim, SYM } from "./theme.js";

/**
 * The two primitives a flow needs in order to move backwards.
 *
 * Going back is un-drawing, not re-printing. A flow that answered "back" by
 * writing the earlier question again would leave the wrong answer sitting in
 * the scrollback above it, and the rail would read as a transcript of the
 * user's indecision. So the engine rewinds the terminal instead: it remembers
 * how far down the screen each question started, and erases back to that row.
 *
 * That needs an exact cursor position, which no terminal will tell us — so
 * {@link createScreen} derives it by watching everything written through it,
 * clack's own frames included. And it needs to know *why* a prompt ended, so
 * {@link watchBack} listens alongside clack and reports whether the key that
 * closed it was Escape (back) rather than Ctrl-C (quit).
 *
 * The other half is telling the reader any of this is possible, which
 * {@link keyFooter} does in clack's own footer, under the prompt the keys act
 * on.
 */

/** Matches a CSI sequence — the cursor moves and erases clack emits. */
const CSI = /\x1b\[([?0-9;]*)([A-Za-z])/g;
/** Styling, which occupies no columns and belongs to the row it is written on. */
const SGR = /\x1b\[[0-9;]*m/;

/** Visible text of a styled string. */
const plain = (text: string): string => text.replace(CSI, "");
/**
 * Where a run has drawn to, and how to take some of it back.
 *
 * `row` counts screen rows travelled since the flow began — the coordinate a
 * checkpoint stores. It is derived, not measured: every write is scanned for
 * newlines, wraps and cursor moves. That is exact for clack, which wraps its
 * frames to the terminal width before writing them.
 */
export interface Screen extends Output {
	/** Rows below the flow's first line the cursor currently sits on. */
	readonly row: number;
	/** Erases back up to `row`, leaving the cursor at its start of line. */
	rewind(row: number): void;
	/**
	 * Keeps `line` drawn inside the frame of the prompt below, on the row above
	 * its closing corner — where clack draws the key footer of the prompts that
	 * have one. Pass `undefined` to take it away again.
	 *
	 * It is redrawn after every write and taken back down before the next one,
	 * so clack renders against the screen it thinks it left behind and never
	 * has to know. Where the frame does not end in a closing corner — a
	 * submitted prompt, or one whose shape we do not recognise — nothing is
	 * drawn, so an unfamiliar frame goes without a footer rather than wrong.
	 */
	overlay(line: string | undefined): void;
	/**
	 * The same object, typed as the stream clack asks for.
	 *
	 * It is not a real `Writable` — it implements only the few members clack
	 * touches (`write`, `columns`, `rows`, `isTTY` and the resize listeners),
	 * which is what lets any `Output` sit underneath it, a test buffer
	 * included. Keeping the cast behind one property keeps it to one place.
	 */
	readonly stream: Writable;
}

/**
 * Wraps a sink so everything drawn through it is counted.
 *
 * The returned object is also handed to clack as its `output`, which is what
 * makes the count whole: prompts are the bulk of what a flow draws, and a
 * count that omitted them could not rewind past one.
 */
export function createScreen(sink: Output): Screen {
	// Delegating rather than subclassing: `sink` may be any `Output`, including
	// a plain buffer in tests, and clack only ever reaches for these few
	// stream members. Missing ones stay undefined and clack falls back.
	const stream = sink as Partial<NodeJS.WriteStream> & Output;

	let row = 0;
	let col = 0;
	/**
	 * What has been written on each row, styling included.
	 *
	 * Only the overlay reads it, and only ever the one row above the cursor —
	 * but it has to be that row's *actual* text, not an assumption about it. A
	 * clack prompt closes on `└` until a validation fails, when the same row
	 * becomes `└  too short`; restoring the corner we expected would take the
	 * message away with it.
	 *
	 * Rows are appended to as they are written, which is how clack writes a
	 * frame: line by line from the left, after clearing what was there.
	 */
	const rows: string[] = [""];

	/** Terminal width, re-read each write so a resize mid-flow is honoured. */
	const columns = (): number => stream.columns ?? process.stdout.columns ?? 80;

	/** Advances the tracked cursor over one written chunk. */
	function track(chunk: string): void {
		const cols = columns();
		let at = 0;
		let pending = "";
		const flush = (): void => {
			if (pending === "") return;
			rows[row] = (rows[row] ?? "") + pending;
			pending = "";
		};
		const newline = (): void => {
			flush();
			row += 1;
			col = 0;
			rows[row] ??= "";
		};
		CSI.lastIndex = 0;
		for (let m = CSI.exec(chunk); ; m = CSI.exec(chunk)) {
			const end = m ? m.index : chunk.length;
			for (let k = at; k < end; k++) {
				const ch = chunk[k];
				if (ch === "\n") {
					newline();
				} else if (ch === "\r") {
					flush();
					col = 0;
					rows[row] = "";
				} else {
					// Terminals defer the wrap: a line filled to the last column
					// stays on that row until one more character arrives.
					if (col >= cols) newline();
					pending += ch;
					col += 1;
				}
			}
			flush();
			if (!m) break;
			at = m.index + m[0].length;
			const params = m[1] ?? "";
			const n = params === "" ? 1 : Number.parseInt(params, 10) || 0;
			switch (m[2]) {
				case "A":
					row -= n;
					break;
				case "B":
					row += n;
					break;
				case "C":
					col += n;
					break;
				case "D":
					col = Math.max(0, col - n);
					break;
				case "G":
				case "H":
					col = 0;
					break;
				case "K":
					rows[row] = "";
					break;
				case "J":
					rows.length = row + 1;
					if (col === 0) rows[row] = "";
					break;
				default:
					// Styling belongs to the row it was written on; cursor
					// visibility and anything else moves and marks nothing.
					if (SGR.test(m[0])) rows[row] = (rows[row] ?? "") + m[0];
					break;
			}
		}
	}

	/** The line the overlay is currently standing in for, if it is drawn. */
	let displaced: string | undefined;
	let overlayLine: string | undefined;

	/**
	 * Puts the overlay up, if the frame below ends the way we expect.
	 *
	 * The cursor comes back to the start of its row rather than its exact
	 * column, which is safe because clack opens every redraw by going to column
	 * zero itself.
	 */
	function draw(): void {
		if (overlayLine === undefined || row < 1) return;
		const closing = rows[row - 1];
		if (closing === undefined || !plain(closing).startsWith(SYM.barEnd)) return;
		displaced = closing;
		sink.write(`\x1b[999D\x1b[1A\x1b[J${overlayLine}\n${closing}\n\x1b[1A\x1b[999D`);
	}

	/** Takes it back down, leaving the screen exactly as clack left it. */
	function undraw(): void {
		if (displaced === undefined) return;
		sink.write(`\x1b[999D\x1b[1A\x1b[J${displaced}\n`);
		displaced = undefined;
	}

	return {
		write(chunk: string) {
			undraw();
			track(chunk);
			const wrote = sink.write(chunk);
			draw();
			return wrote;
		},
		overlay(line: string | undefined) {
			undraw();
			overlayLine = line;
			draw();
		},
		get row() {
			return row;
		},
		rewind(to: number) {
			undraw();
			const up = row - to;
			if (up < 0) return;
			// Column first, then rows, then erase everything below: the same
			// order clack restores its own frame in.
			sink.write(`\x1b[999D${up > 0 ? `\x1b[${up}A` : ""}\x1b[J`);
			rows.length = to + 1;
			rows[to] = "";
			row = to;
			col = 0;
		},
		// --- the stream surface clack reaches for -----------------------------
		get columns() {
			return stream.columns;
		},
		get rows() {
			return stream.rows;
		},
		get isTTY() {
			return stream.isTTY;
		},
		on(event: string, listener: () => void) {
			stream.on?.(event as "resize", listener);
			return this;
		},
		addListener(event: string, listener: () => void) {
			stream.addListener?.(event as "resize", listener);
			return this;
		},
		off(event: string, listener: () => void) {
			stream.off?.(event as "resize", listener);
			return this;
		},
		removeListener(event: string, listener: () => void) {
			stream.removeListener?.(event as "resize", listener);
			return this;
		},
		get stream(): Writable {
			return this as unknown as Writable;
		},
	} as Screen;
}

/** A running watch on the key that ends the current prompt. */
export interface BackWatch {
	/** True when the prompt was closed by Escape rather than Ctrl-C. */
	readonly pressed: boolean;
	stop(): void;
}

/**
 * Listens for Escape alongside the running prompt.
 *
 * Clack aliases Escape to cancel, so by the time a prompt resolves both
 * Escape and Ctrl-C look identical — one cancel symbol. Reading the keypress
 * stream ourselves is what separates them, and it is safe to share: clack
 * emits keypress events on the input stream, so a second listener sees the
 * same keys without consuming them.
 */
export function watchBack(input: NodeJS.ReadStream): BackWatch {
	const state = { pressed: false };
	const onKeypress = (_char: string, key?: { name?: string }): void => {
		// Only ever true for the key that closed the prompt: any other key
		// clears it, so an Escape typed into a prompt that went on to be
		// answered normally cannot leak into the next one.
		state.pressed = key?.name === "escape";
	};
	input.on("keypress", onKeypress);
	return {
		get pressed() {
			return state.pressed;
		},
		stop() {
			input.off("keypress", onKeypress);
		},
	};
}

/** The prompt shapes whose key footer we compose. */
export type Keyed = "select" | "multiselect";

/** Clack's own entries, taken before we ever write to those arrays. */
const CLACK_KEYS = {
	select: [...SELECT_INSTRUCTIONS],
	multiselect: [...MULTISELECT_INSTRUCTIONS],
};

/**
 * The keys a prompt answers to, in clack's own wording and order.
 *
 * These are clack's own, verbatim — the added entries have to be
 * indistinguishable from the ones already there, so the ones already there are
 * left alone.
 *
 * Every prompt but a multi-select names the same keys, whether or not each one
 * does something on it. A footer is chrome, not a status line: a reader learns
 * it once and then stops reading it, and an entry that comes and goes with the
 * kind of question being asked is read as the *keys* coming and going, which
 * is a worse lie than an entry that is briefly inert. A multi-select is the
 * one exception, and only because it adds a key rather than dropping one.
 */
function entries(kind: Keyed, back: boolean): string[] {
	const keys = kind === "multiselect" ? CLACK_KEYS.multiselect : CLACK_KEYS.select;
	return [...keys, ...(back ? [`${dim("Esc:")} back`] : []), `${dim("Ctrl+C:")} quit`];
}

/**
 * Rewrites the footer clack draws under its list prompts to include our keys.
 *
 * Clack already draws one there, already positions it and already styles it; a
 * second line of our own beside it would be two answers to one question. Its
 * entries are module-level arrays read at render time, so this rewrites them
 * before each prompt rather than once at load.
 */
export function keyFooter(kind: Keyed, back: boolean): void {
	const target = kind === "select" ? SELECT_INSTRUCTIONS : MULTISELECT_INSTRUCTIONS;
	target.length = 0;
	target.push(...entries(kind, back));
}

/**
 * The same footer as one line, for the prompts clack gives none.
 *
 * Built with clack's own formatter, so the line is identical to the one it
 * would have drawn itself — which is the point: a text field's footer and a
 * list's are the same line, in the same place, saying the same thing.
 */
export function keyLine(back: boolean): string {
	return formatInstructionFooter(entries("select", back), true)[0] ?? "";
}

/**
 * Makes Tab and Shift+Tab step through a prompt's options.
 *
 * Not an alias in clack's own table: it matches aliases on the key's *name*,
 * and Node reports Shift+Tab as `tab` with a shift flag, so a `tab -> down`
 * alias would send both directions down the list. Re-emitting the arrow key
 * the user meant keeps the two apart and leaves clack's key handling alone —
 * it sees an ordinary Up or Down and never learns Tab was involved.
 */
export function cycleOnTab(input: NodeJS.ReadStream): () => void {
	const onKeypress = (_char: string | undefined, key?: { name?: string; shift?: boolean }): void => {
		if (key?.name !== "tab") return;
		const up = key.shift === true;
		// The char is left undefined, exactly as a real arrow key arrives.
		input.emit("keypress", undefined, {
			name: up ? "up" : "down",
			sequence: up ? "\x1b[A" : "\x1b[B",
			ctrl: false,
			meta: false,
			shift: false,
		});
	};
	input.on("keypress", onKeypress);
	return () => {
		input.off("keypress", onKeypress);
	};
}
