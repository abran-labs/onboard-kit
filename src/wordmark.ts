import { colorEnabled } from "./theme.js";

/**
 * A lowercase block font for rendering a product name as a wordmark.
 *
 * Grid: cells are two independently-coloured pixels (top/bottom half), which
 * is what gives the letterforms their shaded depth — a technique borrowed
 * from opencode's logo (`packages/tui/src/logo.ts`, MIT). Letters are drawn
 * as three body rows, with an optional ascender row above and descender row
 * below. A band is included for the *word* only when some letter in it
 * actually needs it, so "an" stays three rows tall while "kit" grows a
 * fourth for its ascenders.
 *
 * Only lowercase a–z is drawn — no digits, no punctuation. Anything else
 * (falling outside that set, including whitespace) degrades to a blank
 * space rather than throwing, because a logo is decoration and must never be
 * able to fail a setup flow.
 */

/** A cell's two pixels, each 0 = off, 1 = ink, 2 = shadow. */
/** One half-cell: empty, ink, or shadow fill. */
type Pixel = 0 | 1 | 2;
type Cell = readonly [Pixel, Pixel];

interface RawGlyph {
	readonly asc?: string;
	readonly body: readonly [string, string, string];
	readonly desc?: string;
}

interface Glyph {
	readonly width: number;
	readonly hasAsc: boolean;
	readonly hasDesc: boolean;
	readonly asc: readonly Cell[];
	readonly r0: readonly Cell[];
	readonly r1: readonly Cell[];
	readonly r2: readonly Cell[];
	readonly desc: readonly Cell[];
}

type Band = "asc" | "r0" | "r1" | "r2" | "desc";

/**
 * Marks, decoded to `[top, bottom]`:
 *   █ ▀ ▄   ink only, no shadow
 *   _       shadow both halves
 *   ^       ink top, shadow bottom
 *   '       shadow top, ink bottom
 *   ~ ,     shadow top / shadow bottom, the other half off
 */
const MARKS: Record<string, Cell> = {
	" ": [0, 0],
	"█": [1, 1],
	"▀": [1, 0],
	"▄": [0, 1],
	_: [2, 2],
	"^": [1, 2],
	"'": [2, 1],
	"~": [2, 0],
	",": [0, 2],
};

const OFF: Cell = [0, 0];

function decodeRow(row: string | undefined, width: number): readonly Cell[] {
	const s = (row ?? "").padEnd(width);
	return Array.from({ length: width }, (_, i) => MARKS[s[i] as string] ?? OFF);
}

const RAW: Record<string, RawGlyph> = {
	a: { body: ["▀▀▀█", "█^^█", "▀▀▀▀"] },
	b: { asc: "█   ", body: ["█▀▀█", "█__█", "▀▀▀▀"] },
	c: { body: ["█▀▀▀", "█___", "▀▀▀▀"] },
	d: { asc: "   █", body: ["█▀▀█", "█__█", "▀▀▀▀"] },
	e: { body: ["█▀▀█", "█^^^", "▀▀▀▀"] },
	f: { asc: " █▀▀", body: ["▄█▄ ", " █_ ", " ▀~ "] },
	g: { body: ["█▀▀█", "█__█", "▀▀▀█"], desc: "▀▀▀▀" },
	h: { asc: "█   ", body: ["█▀▀█", "█__█", "▀~~▀"] },
	i: { body: ["▀", "█", "▀"] },
	j: { asc: "   ", body: ["  █", "  █", "█'█"], desc: "   " },
	k: { asc: "    ", body: ["█ ▄▀", "█^▄ ", "▀~~▀"] },
	l: { asc: "█  ", body: ["█  ", "█__", "▀▀▀"] },
	m: { body: ["█▀█▀█", "█_█_█", "▀~▀~▀"] },
	n: { body: ["█▀▀█", "█__█", "▀~~▀"] },
	o: { body: ["█▀▀█", "█__█", "▀▀▀▀"] },
	p: { body: ["█▀▀█", "█__█", "█▀▀▀"], desc: "█   " },
	q: { body: ["█▀▀█", "█__█", "▀▀▀█"], desc: "   █" },
	r: { body: ["█▀▀▄", "█   ", "▀   "] },
	s: { body: ["█▀▀▀", "^^^█", "▀▀▀▀"] },
	t: { asc: " █ ", body: ["▀█▀", " █_", " ▀▀"] },
	u: { body: ["█  █", "█__█", "▀▀▀▀"] },
	v: { body: ["█  █", "█__█", " ▀▀ "] },
	w: { body: ["█ █ █", "█_█_█", "▀▀▀▀▀"] },
	x: { body: ["█  █", "▄^^▄", "▀~~▀"] },
	y: { body: ["█  █", "█__█", "▀▀▀█"], desc: "▄▄▄█" },
	z: { body: ["▀▀█", "▄^_", "▀▀▀"] },
	" ": { body: ["  ", "  ", "  "] },
};

const GLYPHS: Record<string, Glyph> = Object.fromEntries(
	Object.entries(RAW).map(([ch, raw]) => {
		const width = raw.body[0].length;
		return [
			ch,
			{
				width,
				hasAsc: raw.asc !== undefined,
				hasDesc: raw.desc !== undefined,
				asc: decodeRow(raw.asc, width),
				r0: decodeRow(raw.body[0], width),
				r1: decodeRow(raw.body[1], width),
				r2: decodeRow(raw.body[2], width),
				desc: decodeRow(raw.desc, width),
			},
		];
	}),
);

const SPACE_GLYPH = GLYPHS[" "] as Glyph;

function glyphFor(ch: string): Glyph {
	return GLYPHS[ch] ?? SPACE_GLYPH;
}

// ------------------------------------------------------------------ styling

const ESC = "\x1b[";
/** Bright-black, foreground and background — the same grey the rail uses. */
const SHADOW_FG = "90";
const SHADOW_BG = "100";
const BOLD = "1";

/**
 * Applies an SGR code list to one glyph character.
 *
 * Cells are never nested inside another styled span — each wordmark line is
 * written on its own — so a blanket `0` reset is safe here, unlike the rest
 * of the theme, which nests `dim()` and friends inside coloured text.
 */
function sgr(codes: readonly string[], text: string): string {
	if (!colorEnabled() || codes.length === 0) return text;
	return `${ESC}${codes.join(";")}m${text}${ESC}0m`;
}

function renderCell([top, bottom]: Cell, accentCode: string | undefined): string {
	const ink = [BOLD, ...(accentCode ? [accentCode] : [])];
	if (top === 1 && bottom === 1) return sgr(ink, "█");
	if (top === 1 && bottom === 0) return sgr(ink, "▀");
	if (top === 0 && bottom === 1) return sgr(ink, "▄");
	if (top === 2 && bottom === 2) {
		// A pure shadow cell has no glyph of its own — the fill IS the colour,
		// so without colour there is nothing to show. Substitute a visible
		// light-shade block instead of leaving an invisible hole.
		return colorEnabled() ? sgr([SHADOW_BG], " ") : "▒";
	}
	if (top === 1 && bottom === 2) return sgr([...ink, SHADOW_BG], "▀");
	if (top === 2 && bottom === 1) return sgr([...ink, SHADOW_BG], "▄");
	if (top === 2 && bottom === 0) return colorEnabled() ? sgr([SHADOW_FG], "▀") : "░";
	if (top === 0 && bottom === 2) return colorEnabled() ? sgr([SHADOW_FG], "▄") : "░";
	return " ";
}

// -------------------------------------------------------------------- layout

/** Room the theme leaves for the wordmark's indent, plus a little slack. */
const CHROME_COLUMNS = 6;

export interface WordmarkOptions {
	/**
	 * Raw SGR colour code applied to ink pixels, e.g. `"36"` for cyan. Omit for
	 * the terminal's default foreground — ink is always bold regardless.
	 * Shadow pixels are always grey and never take this colour, matching the
	 * rest of the template's chrome.
	 */
	readonly accentCode?: string;
	/**
	 * Columns available. Used to pick the scale; defaults to the terminal
	 * width, or 80 when that is unknown.
	 */
	readonly maxWidth?: number;
	/**
	 * Cells per pixel. `"auto"` (the default) uses 2 when it fits and 1 when it
	 * does not.
	 *
	 * A terminal cell is about twice as tall as it is wide, so drawing one
	 * pixel per cell renders every letter at double height — which reads as
	 * tall and skinny. Two cells per pixel restores roughly square pixels.
	 */
	readonly scale?: 1 | 2 | "auto";
	/**
	 * Slides the letters up by half a cell, into the space above the block.
	 *
	 * A band row is two pixels tall, so a half-cell offset is expressible: the
	 * pixel grid is re-paired one pixel later, which costs one extra row but
	 * clips nothing. The caller places its frame corner however deep into the
	 * result it likes — see {@link wordmarkCorner}.
	 */
	readonly halfStep?: boolean;
}

/**
 * Which row of a {@link wordmark} the frame's opening corner belongs on, for a
 * given lift measured in half-cells. Rows above it carry no rail: the letters
 * overhang the corner rather than being cut off by it.
 */
export function wordmarkCorner(liftHalves: number): number {
	return Math.ceil(Math.max(liftHalves, 0) / 2);
}

function bandCells(glyph: Glyph, band: Band): readonly Cell[] {
	if (band === "asc") return glyph.hasAsc ? glyph.asc : Array.from({ length: glyph.width }, () => OFF);
	if (band === "desc") return glyph.hasDesc ? glyph.desc : Array.from({ length: glyph.width }, () => OFF);
	return glyph[band];
}

/**
 * Renders `text` as a wordmark, three to five lines tall depending on which
 * letters it contains.
 *
 * An empty result means there was nothing drawable, or nothing would fit
 * even at the smallest scale — the caller falls back to plain text.
 */
export function wordmark(text: string, options: WordmarkOptions = {}): string[] {
	const { accentCode, scale = "auto" } = options;
	const maxWidth = options.maxWidth ?? process.stdout.columns ?? 80;

	const glyphs = [...text.toLowerCase()].map(glyphFor);
	if (glyphs.length === 0) return [];

	const hasAsc = glyphs.some((g) => g.hasAsc);
	const hasDesc = glyphs.some((g) => g.hasDesc);
	const bands: Band[] = [...(hasAsc ? (["asc"] as const) : []), "r0", "r1", "r2", ...(hasDesc ? (["desc"] as const) : [])];

	const naturalWidth = glyphs.reduce((sum, g) => sum + g.width, 0) + (glyphs.length - 1);
	const fits = (cells: number) => naturalWidth * cells + CHROME_COLUMNS <= maxWidth;

	// Too narrow even at one cell per pixel: draw nothing rather than let the
	// letters wrap, which looks broken. The caller falls back to a plain header.
	if (scale === "auto" && !fits(1)) return [];
	const cells = scale === "auto" ? (fits(2) ? 2 : 1) : scale;

	// Build as cell tokens (with an OFF token for each inter-letter gap) so
	// blanks can be trimmed by state, not by scanning already-styled text for
	// whitespace.
	const bandTokens = bands.map((band) => {
		const tokens: Cell[] = [];
		glyphs.forEach((g, i) => {
			if (i > 0) tokens.push(OFF);
			tokens.push(...bandCells(g, band));
		});
		return tokens;
	});

	const width = bandTokens.reduce((max, t) => Math.max(max, t.length), 0);
	// One pixel row per half-cell: tops of band i, then its bottoms.
	const pixels: Pixel[][] = [];
	for (const tokens of bandTokens) {
		pixels.push(Array.from({ length: width }, (_, c) => tokens[c]?.[0] ?? 0));
		pixels.push(Array.from({ length: width }, (_, c) => tokens[c]?.[1] ?? 0));
	}
	// Re-pairing one pixel later slides every letter up half a cell. Nothing is
	// clipped — the grid grows a row instead.
	if (options.halfStep) pixels.unshift(Array.from({ length: width }, () => 0 as Pixel));

	const rows: string[] = [];
	for (let p = 0; p < pixels.length; p += 2) {
		const top = pixels[p] as Pixel[];
		const bottom = pixels[p + 1];
		const cellsOut: Cell[] = Array.from({ length: width }, (_, c) => [top[c] ?? 0, bottom?.[c] ?? 0]);
		let end = cellsOut.length;
		while (end > 0 && cellsOut[end - 1]?.[0] === 0 && cellsOut[end - 1]?.[1] === 0) end--;
		rows.push(
			cellsOut
				.slice(0, end)
				.map((cell) => renderCell(cell, accentCode).repeat(cells))
				.join(""),
		);
	}

	// A band is only present because *some* letter needed it; a name whose
	// letters all stop short leaves it blank. Drop those edge rows so the
	// wordmark hugs its own letters instead of padding the block it sits in.
	// (Trailing cells are already trimmed above, so a blank row is exactly "".)
	let top = 0;
	let bottom = rows.length;
	while (top < bottom && rows[top] === "") top++;
	while (bottom > top && rows[bottom - 1] === "") bottom--;
	return rows.slice(top, bottom);
}
