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

/** The solid block the font is drawn with, with an ASCII fallback. */
const INK = "█";

/**
 * Renders `text` as a five-line wordmark.
 *
 * Returns the lines without styling or indentation — the theme decides how to
 * colour and place them. An empty result means there was nothing drawable.
 */
export function wordmark(text: string, ink: string = INK): string[] {
	const glyphs = [...text.toUpperCase()].map((char) => GLYPHS[char] ?? GLYPHS[" "] ?? "").filter(Boolean);
	if (glyphs.length === 0) return [];

	const rows: string[] = [];
	for (let row = 0; row < WORDMARK_ROWS; row++) {
		const parts = glyphs.map((glyph) => {
			const lines = glyph.split("|");
			const width = Math.max(...lines.map((l) => l.length));
			return (lines[row] ?? "").padEnd(width);
		});
		rows.push(parts.join(" ").replace(/#/g, ink).replace(/\s+$/, ""));
	}
	// Drop leading/trailing blank rows so short strings do not float.
	while (rows.length > 0 && rows[0]?.trim() === "") rows.shift();
	while (rows.length > 0 && rows[rows.length - 1]?.trim() === "") rows.pop();
	return rows;
}
