import type {
	AnswerBag,
	CheckNode,
	ChoiceNode,
	ConfirmNode,
	DoneNode,
	HasWhen,
	MultiChoiceNode,
	NextEntry,
	NodeOption,
	NoteNode,
	PickNode,
	SecretNode,
	SummaryNode,
	TaskNode,
	TextNode,
	WelcomeNode,
	When,
} from "./types.js";

/**
 * The node catalog — the complete vocabulary for building a flow.
 *
 * Every constructor returns inert data. Adding a node here is cheap; removing
 * one after release is breaking, so the bias is toward shipping fewer.
 *
 * Question constructors infer their whole shape from the options object, so a
 * node declared with `when` yields an *optional* key in the answers type: a
 * guarded question genuinely may not produce an answer.
 */

/** Nodes carry phantom type fields, so construction needs a widening cast. */
const make = <T>(value: object): T => value as unknown as T;

// ---------------------------------------------------------------- display

/** Opening banner. Draws the product name and optional logo from the root config. */
export function welcome(opts: { title?: string; subtitle?: string; when?: When } = {}): WelcomeNode {
	return make({ kind: "welcome", ...opts });
}

/** A boxed callout for something the user genuinely needs to read. */
export function note(opts: { body: string; title?: string; when?: When }): NoteNode {
	return make({ kind: "note", ...opts });
}

/** Closing frame. `next` renders the trailing command list. */
export function done(
	opts: { message?: string; next?: readonly NextEntry[]; when?: When } = {},
): DoneNode {
	return make({ kind: "done", ...opts });
}

// --------------------------------------------------------------- question

interface ChoiceOpts {
	readonly id: string;
	readonly label: string;
	readonly options: readonly NodeOption[];
	readonly default?: string;
	readonly hint?: string;
	readonly when?: When;
}

/**
 * Pick one. Automatically upgrades from a plain list to a filterable
 * autocomplete past `AUTOCOMPLETE_THRESHOLD` options.
 */
export function choice<const O extends ChoiceOpts>(
	opts: O,
): ChoiceNode<O["id"], O["options"][number]["value"], HasWhen<O>> {
	return make({ kind: "choice", ...opts });
}

interface MultiChoiceOpts {
	readonly id: string;
	readonly label: string;
	readonly options: readonly NodeOption[];
	readonly default?: readonly string[];
	readonly min?: number;
	readonly max?: number;
	readonly when?: When;
}

/** Pick any number. Answers as an array in option order. */
export function multiChoice<const O extends MultiChoiceOpts>(
	opts: O,
): MultiChoiceNode<O["id"], O["options"][number]["value"], HasWhen<O>> {
	return make({ kind: "multiChoice", ...opts });
}

interface ConfirmOpts {
	readonly id: string;
	readonly label: string;
	readonly default?: boolean;
	readonly when?: When;
}

/** Yes or no. */
export function confirm<const O extends ConfirmOpts>(opts: O): ConfirmNode<O["id"], HasWhen<O>> {
	return make({ kind: "confirm", ...opts });
}

interface TextOpts {
	readonly id: string;
	readonly label: string;
	readonly placeholder?: string;
	readonly default?: string;
	readonly validate?: (value: string) => string | true;
	readonly when?: When;
}

/** Free text. `validate` returns `true` to accept, or a message to reject. */
export function text<const O extends TextOpts>(opts: O): TextNode<O["id"], HasWhen<O>> {
	return make({ kind: "text", ...opts });
}

interface SecretOpts {
	readonly id: string;
	readonly label: string;
	readonly validate?: (value: string) => string | true;
	readonly when?: When;
}

/**
 * Masked input for credentials.
 *
 * Secrets are never written to the onboarding state file and are always masked
 * in the review table — enforced by the engine, not by convention here.
 */
export function secret<const O extends SecretOpts>(opts: O): SecretNode<O["id"], HasWhen<O>> {
	return make({ kind: "secret", ...opts });
}

interface PickOpts {
	readonly id: string;
	readonly label: string;
	readonly select: "file" | "directory";
	readonly root?: string;
	readonly when?: When;
}

/** Filesystem path picker with completion. */
export function pick<const O extends PickOpts>(opts: O): PickNode<O["id"], HasWhen<O>> {
	return make({ kind: "pick", ...opts });
}

// ------------------------------------------------------------------- work

/**
 * An environment gate. A failing check halts the flow and prints `fix`;
 * `optional: true` downgrades that to a warning and continues.
 *
 * Consecutive checks render grouped under a single header.
 */
export function check<A extends AnswerBag = AnswerBag>(opts: {
	label: string;
	run: (answers: A) => boolean | Promise<boolean>;
	fix?: string;
	optional?: boolean;
	when?: (answers: A) => boolean;
}): CheckNode {
	return make({ kind: "check", ...opts });
}

/** Does the actual work, with a spinner. Throwing fails the flow. */
export function task<A extends AnswerBag = AnswerBag>(opts: {
	label: string;
	run: (answers: A) => unknown | Promise<unknown>;
	when?: (answers: A) => boolean;
}): TaskNode {
	return make({ kind: "task", ...opts });
}

/**
 * The review table.
 *
 * Takes no content: it derives itself from every question node above it,
 * masking secrets. Place it before the `task` nodes that act on the answers.
 */
export function summary(opts: { title?: string; confirm?: boolean; when?: When } = {}): SummaryNode {
	return make({ kind: "summary", ...opts });
}
