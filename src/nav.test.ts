import { PassThrough } from "node:stream";
import { describe, expect, test } from "bun:test";
import { MULTISELECT_INSTRUCTIONS, SELECT_INSTRUCTIONS } from "@clack/prompts";
import { createScreen, cycleOnTab, keyFooter, keyLine, watchBack } from "./nav.js";
import type { Output } from "./run.js";

function sink(columns = 20): Output & { text: string; columns: number } {
	const chunks: string[] = [];
	return {
		columns,
		write(chunk: string) {
			chunks.push(chunk);
			return true;
		},
		get text() {
			return chunks.join("");
		},
	};
}

describe("screen row tracking", () => {
	test("exposes both EventEmitter listener aliases used by clack", () => {
		const output = new PassThrough();
		const screen = createScreen(output);
		const listener = () => {};

		expect(() => {
			screen.stream.on("resize", listener);
			screen.stream.off("resize", listener);
			screen.stream.addListener("resize", listener);
			screen.stream.removeListener("resize", listener);
		}).not.toThrow();
		expect(output.listenerCount("resize")).toBe(0);
	});

	test("counts newlines", () => {
		const screen = createScreen(sink());
		screen.write("one\ntwo\n");
		expect(screen.row).toBe(2);
	});

	test("counts a wrapped line as the rows it actually occupies", () => {
		const screen = createScreen(sink(10));
		// Ten columns exactly: terminals defer the wrap, so this is still one row.
		screen.write("0123456789\n");
		expect(screen.row).toBe(1);
		screen.write("0123456789abc\n");
		expect(screen.row).toBe(3);
	});

	test("ignores styling, which occupies no columns", () => {
		const screen = createScreen(sink(10));
		screen.write(`\x1b[2m0123456789\x1b[22m\n`);
		expect(screen.row).toBe(1);
	});

	test("follows the cursor moves clack redraws with", () => {
		const screen = createScreen(sink());
		screen.write("a\nb\nc\n");
		// What clack emits to restore its frame before redrawing it.
		screen.write("\x1b[999D\x1b[3A\x1b[J");
		expect(screen.row).toBe(0);
		screen.write("x\ny\n");
		expect(screen.row).toBe(2);
	});

	test("a chunk boundary mid-line does not lose the column", () => {
		const screen = createScreen(sink(10));
		screen.write("01234");
		screen.write("56789abc\n");
		expect(screen.row).toBe(2);
	});
});

describe("rewind", () => {
	test("moves up to the row and erases everything below it", () => {
		const out = sink();
		const screen = createScreen(out);
		screen.write("one\n");
		const mark = screen.row;
		screen.write("two\nthree\n");
		screen.rewind(mark);

		expect(out.text.endsWith("\x1b[999D\x1b[2A\x1b[J")).toBe(true);
		expect(screen.row).toBe(mark);
	});

	test("rewinding to the current row erases without moving up", () => {
		const out = sink();
		const screen = createScreen(out);
		screen.write("one\n");
		screen.rewind(screen.row);
		expect(out.text.endsWith("\x1b[999D\x1b[J")).toBe(true);
	});

	test("never winds forward — a stale row is a no-op, not a jump down", () => {
		const out = sink();
		const screen = createScreen(out);
		screen.write("one\n");
		screen.rewind(5);
		expect(out.text).toBe("one\n");
		expect(screen.row).toBe(1);
	});
});

describe("watchBack", () => {
	function keys() {
		const input = new PassThrough() as unknown as NodeJS.ReadStream;
		return { input, press: (name: string) => input.emit("keypress", "", { name }) };
	}

	test("reports Escape, which is what separates back from quit", () => {
		const { input, press } = keys();
		const watch = watchBack(input);
		press("escape");
		expect(watch.pressed).toBe(true);
		watch.stop();
	});

	test("Ctrl-C is not a step back", () => {
		const { input, press } = keys();
		const watch = watchBack(input);
		input.emit("keypress", "\x03", { name: "c", ctrl: true });
		expect(watch.pressed).toBe(false);
		press("escape");
		watch.stop();
	});

	test("an Escape that did not end the prompt cannot leak into the next key", () => {
		const { input, press } = keys();
		const watch = watchBack(input);
		press("escape");
		press("down");
		expect(watch.pressed).toBe(false);
		watch.stop();
	});

	test("stop detaches, so a later prompt is not watched by a dead watch", () => {
		const { input, press } = keys();
		const watch = watchBack(input);
		watch.stop();
		press("escape");
		expect(watch.pressed).toBe(false);
		expect(input.listenerCount("keypress")).toBe(0);
	});
});

describe("key footer", () => {
	// Clack styles its own entries when it loads; ours are styled when they are
	// built. Comparing the words is what makes the two comparable at all.
	const words = (entries: readonly string[]) => entries.join(" • ").replace(/\x1b\[[0-9;]*m/g, "");

	test("appends our keys to clack's own, in clack's own style", () => {
		keyFooter("select", true);
		expect(words(SELECT_INSTRUCTIONS)).toBe("↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit");
	});

	test("claims a step back only where there is one to take", () => {
		keyFooter("select", false);
		expect(words(SELECT_INSTRUCTIONS)).toBe("↑/↓ to navigate • Enter: confirm • Ctrl+C: quit");
	});

	test("`Key:` is dimmed and the verb is not, which is how clack styles its own", () => {
		process.env.FORCE_COLOR = "1";
		keyFooter("select", true);
		process.env.FORCE_COLOR = "";

		expect(SELECT_INSTRUCTIONS.at(-2)).toBe("\x1b[2mEsc:\x1b[22m back");
	});

	test("the prompts clack gives no footer get the very same line", () => {
		keyFooter("select", true);
		expect(words([keyLine(true)])).toBe(`│  ${words(SELECT_INSTRUCTIONS)}`);
		expect(words([keyLine(true)])).toBe("│  ↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit");
	});

	test("rewriting is idempotent — clack's entries are not duplicated", () => {
		keyFooter("multiselect", true);
		const once = [...MULTISELECT_INSTRUCTIONS];
		keyFooter("multiselect", true);

		expect([...MULTISELECT_INSTRUCTIONS]).toEqual(once);
		expect(words(MULTISELECT_INSTRUCTIONS)).toBe(
			"↑/↓ to navigate • Space: select • Enter: confirm • Esc: back • Ctrl+C: quit",
		);
	});
});

describe("cycleOnTab", () => {
	function keys() {
		const input = new PassThrough() as unknown as NodeJS.ReadStream;
		const seen: string[] = [];
		input.on("keypress", (_c, k) => seen.push(k?.name ?? "?"));
		return { input, seen, press: (key: object) => input.emit("keypress", undefined, key) };
	}

	test("Tab arrives as a down, Shift+Tab as an up", () => {
		const { input, seen, press } = keys();
		const stop = cycleOnTab(input);
		press({ name: "tab", shift: false });
		press({ name: "tab", shift: true });
		stop();

		expect(seen).toEqual(["tab", "down", "tab", "up"]);
	});

	test("the arrow it emits does not itself loop back round", () => {
		const { input, seen, press } = keys();
		const stop = cycleOnTab(input);
		press({ name: "down" });
		stop();

		expect(seen).toEqual(["down"]);
	});

	test("stopping detaches, so Tab goes back to doing nothing", () => {
		const { input, seen, press } = keys();
		cycleOnTab(input)();
		press({ name: "tab" });

		expect(seen).toEqual(["tab"]);
	});
});

describe("footer overlay", () => {
	/** Replays writes into a grid, the way a terminal would. */
	function screenOf(text: string): string[] {
		const lines: string[] = [""];
		let row = 0;
		let col = 0;
		const csi = /\x1b\[([?0-9;]*)([A-Za-z])/g;
		let at = 0;
		for (let m = csi.exec(text); ; m = csi.exec(text)) {
			const end = m ? m.index : text.length;
			for (let k = at; k < end; k++) {
				const ch = text[k] as string;
				if (ch === "\n") {
					row += 1;
					col = 0;
					while (lines.length <= row) lines.push("");
				} else {
					const line = (lines[row] ?? "").padEnd(col, " ");
					lines[row] = line.slice(0, col) + ch + line.slice(col + 1);
					col += 1;
				}
			}
			if (!m) break;
			at = m.index + m[0].length;
			const n = m[1] === "" || m[1] === undefined ? 1 : Number.parseInt(m[1], 10) || 0;
			if (m[2] === "A") row = Math.max(0, row - n);
			else if (m[2] === "B") row += n;
			else if (m[2] === "D") col = Math.max(0, col - n);
			else if (m[2] === "G") col = 0;
			else if (m[2] === "J") {
				lines[row] = (lines[row] ?? "").slice(0, col);
				lines.length = row + 1;
			} else if (m[2] === "K") lines[row] = (lines[row] ?? "").slice(0, col);
		}
		return lines;
	}

	/** A frame shaped the way clack closes an active prompt. */
	const FRAME = "│\n◆  API key\n│  ab\n└\n";

	test("goes in above the closing corner, inside the frame", () => {
		const out = sink(80);
		const screen = createScreen(out);
		screen.write(FRAME);
		screen.overlay("│  keys");

		expect(screenOf(out.text)).toEqual(["│", "◆  API key", "│  ab", "│  keys", "└", ""]);
	});

	test("stands in for whatever closed the frame, message and all", () => {
		const out = sink(80);
		const screen = createScreen(out);
		screen.write("│\n◆  API key\n│  a\n└  too short\n");
		screen.overlay("│  keys");

		expect(screenOf(out.text)).toEqual(["│", "◆  API key", "│  a", "│  keys", "└  too short", ""]);
	});

	test("comes down before the next write, so clack redraws against its own screen", () => {
		const out = sink(80);
		const screen = createScreen(out);
		screen.write(FRAME);
		screen.overlay("│  keys");
		const drawn = screen.row;
		// What clack emits to rewrite the value line: up 4, down 2, redraw.
		screen.write("\x1b[999D\x1b[4A\x1b[2B\x1b[2K\x1b[G│  abc\x1b[2B");

		expect(screen.row).toBe(drawn);
		expect(screenOf(out.text)).toEqual(["│", "◆  API key", "│  abc", "│  keys", "└", ""]);
	});

	test("clearing it leaves the screen exactly as it was found", () => {
		const bare = sink(80);
		createScreen(bare).write(FRAME);

		const out = sink(80);
		const screen = createScreen(out);
		screen.write(FRAME);
		screen.overlay("│  keys");
		screen.overlay(undefined);

		expect(screenOf(out.text)).toEqual(screenOf(bare.text));
	});

	test("a frame that does not close the way we expect goes without one", () => {
		const out = sink(80);
		const screen = createScreen(out);
		// A submitted prompt: no closing corner, so nothing to draw above.
		screen.write("◇  API key\n│  ab\n");
		screen.overlay("│  keys");

		expect(screenOf(out.text)).toEqual(["◇  API key", "│  ab", ""]);
	});

	test("does not disturb the row count a rewind depends on", () => {
		const out = sink(80);
		const screen = createScreen(out);
		screen.write("one\n");
		const mark = screen.row;
		screen.write(FRAME);
		screen.overlay("│  keys");
		screen.rewind(mark);

		expect(screen.row).toBe(mark);
		expect(screenOf(out.text)).toEqual(["one", ""]);
	});
});
