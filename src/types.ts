/**
 * Nodes are plain object literals, discriminated on `node`.
 *
 * They are inert data: no constructors, no I/O, nothing rendered. The engine
 * in `run.ts` interprets them, which is what lets it reason about a flow
 * (which questions are outstanding, what a non-interactive run needs) without
 * executing it.
 *
 * Literals rather than constructor functions is a deliberate choice. A
 * constructor call resolves its own generics before `onboard()` ever sees the
 * array, so its callbacks can never be typed against sibling nodes. Contextual
 * typing *does* flow into object literals, so `onboard<Answers>({...})` types
 * every `run` and `when` callback correctly — which no constructor-based API
 * can do.
 */

/**
 * The default shape for `when` and `run` callbacks.
 *
 * Without an explicit type argument on `onboard`, callbacks receive this loose
 * bag. Pass one — `onboard<Answers>({...})` — and they are fully typed.
 */
// biome-ignore lint/suspicious/noExplicitAny: intentional escape hatch, see above.
export type AnswerBag = Record<string, any>;

export interface NodeOption<V extends string = string> {
	readonly value: V;
	readonly label?: string;
	readonly hint?: string;
}

export interface NextEntry {
	readonly cmd: string;
	readonly desc?: string;
}

/** Returns `true` to accept the value, or a message explaining the rejection. */
export type Validator = (value: string) => string | true;

// ---------------------------------------------------------------- display

export interface WelcomeNode<A> {
	readonly node: "welcome";
	readonly title?: string;
	readonly subtitle?: string;
	readonly when?: (answers: A) => boolean;
}

export interface NoteNode<A> {
	readonly node: "note";
	readonly title?: string;
	readonly body: string;
	readonly when?: (answers: A) => boolean;
}

export interface DoneNode<A> {
	readonly node: "done";
	readonly message?: string;
	readonly next?: readonly NextEntry[];
	readonly when?: (answers: A) => boolean;
}

// --------------------------------------------------------------- question

export interface ChoiceNode<A> {
	readonly node: "choice";
	readonly id: string;
	readonly label: string;
	readonly options: readonly NodeOption[];
	readonly default?: string;
	readonly hint?: string;
	readonly when?: (answers: A) => boolean;
}

export interface MultiChoiceNode<A> {
	readonly node: "multiChoice";
	readonly id: string;
	readonly label: string;
	readonly options: readonly NodeOption[];
	readonly default?: readonly string[];
	readonly min?: number;
	readonly max?: number;
	readonly when?: (answers: A) => boolean;
}

export interface ConfirmNode<A> {
	readonly node: "confirm";
	readonly id: string;
	readonly label: string;
	readonly default?: boolean;
	readonly when?: (answers: A) => boolean;
}

export interface TextNode<A> {
	readonly node: "text";
	readonly id: string;
	readonly label: string;
	readonly placeholder?: string;
	readonly default?: string;
	readonly validate?: Validator;
	readonly when?: (answers: A) => boolean;
}

export interface SecretNode<A> {
	readonly node: "secret";
	readonly id: string;
	readonly label: string;
	readonly validate?: Validator;
	readonly when?: (answers: A) => boolean;
}

export interface PickNode<A> {
	readonly node: "pick";
	readonly id: string;
	readonly label: string;
	readonly select: "file" | "directory";
	readonly root?: string;
	readonly when?: (answers: A) => boolean;
}

// ------------------------------------------------------------------- work

export interface CheckNode<A> {
	readonly node: "check";
	readonly label: string;
	readonly run: (answers: A) => boolean | Promise<boolean>;
	/** Shown when the check fails. */
	readonly fix?: string;
	/** Warn and continue instead of halting the flow. */
	readonly optional?: boolean;
	readonly when?: (answers: A) => boolean;
}

export interface TaskNode<A> {
	readonly node: "task";
	readonly label: string;
	readonly run: (answers: A) => unknown | Promise<unknown>;
	readonly when?: (answers: A) => boolean;
}

export interface SummaryNode<A> {
	readonly node: "summary";
	readonly title?: string;
	/** Gate continuing on an explicit yes. Defaults to `true`. */
	readonly confirm?: boolean;
	readonly when?: (answers: A) => boolean;
}

// ------------------------------------------------------------------ union

export type QuestionNode<A = AnswerBag> =
	| ChoiceNode<A>
	| MultiChoiceNode<A>
	| ConfirmNode<A>
	| TextNode<A>
	| SecretNode<A>
	| PickNode<A>;

export type Node<A = AnswerBag> =
	| WelcomeNode<A>
	| NoteNode<A>
	| DoneNode<A>
	| QuestionNode<A>
	| CheckNode<A>
	| TaskNode<A>
	| SummaryNode<A>;

const QUESTION_NODES = new Set(["choice", "multiChoice", "confirm", "text", "secret", "pick"]);

export function isQuestion(node: Node): node is QuestionNode {
	return QUESTION_NODES.has(node.node);
}

// -------------------------------------------------------- answer inference

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void
	? I
	: never;

/** A `when` guard makes the key optional: the question may never be asked. */
type Entry<N, Id extends string, V> = N extends { when: unknown } ? { [K in Id]?: V } : { [K in Id]: V };

type ValueOf<O> = O extends { value: infer V } ? V : never;

type EntryOf<N> = N extends { node: "choice"; id: infer Id extends string; options: readonly (infer O)[] }
	? Entry<N, Id, ValueOf<O>>
	: N extends { node: "multiChoice"; id: infer Id extends string; options: readonly (infer O)[] }
		? Entry<N, Id, ValueOf<O>[]>
		: N extends { node: "confirm"; id: infer Id extends string }
			? Entry<N, Id, boolean>
			: N extends { node: "text" | "secret" | "pick"; id: infer Id extends string }
				? Entry<N, Id, string>
				: never;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Derives the answers object from a node list — for example
 * `{ provider: "openai" | "anthropic"; apiKey?: string }`, where `apiKey` is
 * optional because its node declared a `when` guard.
 */
export type AnswersOf<Nodes extends readonly unknown[]> = Prettify<UnionToIntersection<EntryOf<Nodes[number]>>>;
