/**
 * A five-row block font for rendering a product name as a wordmark.
 *
 * Kept deliberately small: capitals, digits and a little punctuation. Anything
 * it cannot draw falls back to a space rather than throwing, because a logo is
 * decoration and must never be able to fail a setup flow.
 *
 * Glyphs are stored as `#`-and-space rows joined by `|`. Each glyph declares
 * its own width, so letters keep their natural proportions.
 */

const GLYPHS: Record<string, string> = {
	A: " ## |#  #|####|#  #|#  #",
	B: "### |#  #|### |#  #|### ",
	C: " ###|#   |#   |#   | ###",
	D: "### |#  #|#  #|#  #|### ",
	E: "####|#   |### |#   |####",
	F: "####|#   |### |#   |#   ",
	G: " ###|#   |# ##|#  #| ###",
	H: "#  #|#  #|####|#  #|#  #",
	I: "###| # | # | # |###",
	J: "  ##|   #|   #|#  #| ## ",
	K: "#  #|# # |##  |# # |#  #",
	L: "#   |#   |#   |#   |####",
	M: "#   #|## ##|# # #|#   #|#   #",
	N: "#  #|## #|# ##|#  #|#  #",
	O: " ## |#  #|#  #|#  #| ## ",
	P: "### |#  #|### |#   |#   ",
	Q: " ## |#  #|#  #|# ##| ###",
	R: "### |#  #|### |# # |#  #",
	S: " ###|#   | ## |   #|### ",
	T: "#####|  #  |  #  |  #  |  #  ",
	U: "#  #|#  #|#  #|#  #| ## ",
	V: "#   #|#   #|#   #| # # |  #  ",
	W: "#   #|#   #|# # #|## ##|#   #",
	X: "#   #| # # |  #  | # # |#   #",
	Y: "#   #| # # |  #  |  #  |  #  ",
	Z: "####|   #|  # | #  |####",
	"0": " ## |#  #|# ##|## #| ## ",
	"1": " # |## | # | # |###",
	"2": "### |   #| ## |#   |####",
	"3": "### |   #| ## |   #|### ",
	"4": "#  #|#  #|####|   #|   #",
	"5": "####|#   |### |   #|### ",
	"6": " ## |#   |### |#  #| ## ",
	"7": "####|   #|  # | #  | #  ",
	"8": " ## |#  #| ## |#  #| ## ",
	"9": " ## |#  #| ###|   #| ## ",
	" ": "  |  |  |  |  ",
	"-": "    |    |####|    |    ",
	".": "  |  |  |  |##",
	"!": "#|#|#| |#",
	"?": "### |   #| ## |    |  # ",
};

export const WORDMARK_ROWS = 5;

/** The solid block the font is drawn with. */
const INK = "█";

/** Room the theme leaves for the wordmark's indent, plus a little slack. */
const CHROME_COLUMNS = 6;

export interface WordmarkOptions {
	/** The character to draw with. Defaults to a full block. */
	readonly ink?: string;
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
}

/**
 * Renders `text` as a five-line wordmark.
 *
 * Returns the lines without styling or indentation — the theme decides how to
 * colour and place them. An empty result means there was nothing drawable.
 */
export function wordmark(text: string, options: WordmarkOptions = {}): string[] {
	const { ink = INK, scale = "auto" } = options;
	const maxWidth = options.maxWidth ?? process.stdout.columns ?? 80;

	const glyphs = [...text.toUpperCase()].map((char) => GLYPHS[char] ?? GLYPHS[" "] ?? "").filter(Boolean);
	if (glyphs.length === 0) return [];

	const bitmap: string[] = [];
	for (let row = 0; row < WORDMARK_ROWS; row++) {
		const parts = glyphs.map((glyph) => {
			const lines = glyph.split("|");
			const width = Math.max(...lines.map((l) => l.length));
			return (lines[row] ?? "").padEnd(width);
		});
		bitmap.push(parts.join(" "));
	}

	const naturalWidth = Math.max(...bitmap.map((r) => r.trimEnd().length));
	const fits = (cells: number) => naturalWidth * cells + CHROME_COLUMNS <= maxWidth;

	// Too narrow even at one cell per pixel: draw nothing rather than let the
	// letters wrap, which looks broken. The caller falls back to a plain header.
	if (scale === "auto" && !fits(1)) return [];

	const cells = scale === "auto" ? (fits(2) ? 2 : 1) : scale;

	const rows = bitmap.map((row) =>
		[...row]
			.map((cell) => (cell === "#" ? ink : " ").repeat(cells))
			.join("")
			.replace(/\s+$/, ""),
	);

	// Drop leading/trailing blank rows so short strings do not float.
	while (rows.length > 0 && rows[0]?.trim() === "") rows.shift();
	while (rows.length > 0 && rows[rows.length - 1]?.trim() === "") rows.pop();
	return rows;
}
