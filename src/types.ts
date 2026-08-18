/**
 * Node descriptors and the type-level machinery that infers an answers object
 * from a node list.
 *
 * Nodes are inert data. Constructing one performs no I/O and renders nothing —
 * the engine in `run.ts` interprets them. That is what lets the engine reason
 * about a flow (which steps are outstanding, what a non-interactive run needs)
 * without executing it.
 */

/**
 * The loose shape handed to `when` and `run` callbacks.
 *
 * A node is constructed before the flow that contains it exists, so it cannot
 * know the full answers type. Callbacks default to this bag; pass an explicit
 * type argument (`task<MyAnswers>({...})`) when you want the callback typed.
 */
// biome-ignore lint/suspicious/noExplicitAny: intentional escape hatch, see above.
export type AnswerBag = Record<string, any>;

export type When = (answers: AnswerBag) => boolean;

export interface NodeOption<V extends string = string> {
	readonly value: V;
	readonly label?: string;
	readonly hint?: string;
}

export interface NextEntry {
	readonly cmd: string;
	readonly desc?: string;
}

/**
 * Marks a node that contributes an answer, carrying its value type and
 * whether that answer is conditional.
 *
 * `Opt` is `true` for nodes declared with `when`, which makes their key
 * optional in the inferred answers object — a guarded node genuinely may not
 * produce an answer, and the type should say so.
 */
export interface AnswerCarrier<Id extends string, V, Opt extends boolean = false> {
	readonly id: Id;
	/** Phantom: present in the type, never at runtime. */
	readonly __value: V;
	/** Phantom: whether this answer is conditional. */
	readonly __optional: Opt;
}

/** `true` when an options object declared a `when` guard. */
export type HasWhen<O> = O extends { when: unknown } ? true : false;

// ---------------------------------------------------------------- display

export interface WelcomeNode {
	readonly kind: "welcome";
	readonly title?: string;
	readonly subtitle?: string;
	readonly when?: When;
}

export interface NoteNode {
	readonly kind: "note";
	readonly title?: string;
	readonly body: string;
	readonly when?: When;
}

export interface DoneNode {
	readonly kind: "done";
	readonly message?: string;
	readonly next?: readonly NextEntry[];
	readonly when?: When;
}

// --------------------------------------------------------------- question

export interface ChoiceNode<Id extends string, V extends string, Opt extends boolean = false>
	extends AnswerCarrier<Id, V, Opt> {
	readonly kind: "choice";
	readonly label: string;
	readonly options: readonly NodeOption<V>[];
	readonly default?: V;
	readonly hint?: string;
	readonly when?: When;
}

export interface MultiChoiceNode<Id extends string, V extends string, Opt extends boolean = false>
	extends AnswerCarrier<Id, V[], Opt> {
	readonly kind: "multiChoice";
	readonly label: string;
	readonly options: readonly NodeOption<V>[];
	readonly default?: readonly V[];
	readonly min?: number;
	readonly max?: number;
	readonly when?: When;
}

export interface ConfirmNode<Id extends string, Opt extends boolean = false> extends AnswerCarrier<Id, boolean, Opt> {
	readonly kind: "confirm";
	readonly label: string;
	readonly default?: boolean;
	readonly when?: When;
}

export interface TextNode<Id extends string, Opt extends boolean = false> extends AnswerCarrier<Id, string, Opt> {
	readonly kind: "text";
	readonly label: string;
	readonly placeholder?: string;
	readonly default?: string;
	readonly validate?: (value: string) => string | true;
	readonly when?: When;
}

export interface SecretNode<Id extends string, Opt extends boolean = false> extends AnswerCarrier<Id, string, Opt> {
	readonly kind: "secret";
	readonly label: string;
	readonly validate?: (value: string) => string | true;
	readonly when?: When;
}

export interface PickNode<Id extends string, Opt extends boolean = false> extends AnswerCarrier<Id, string, Opt> {
	readonly kind: "pick";
	readonly label: string;
	readonly select: "file" | "directory";
	readonly root?: string;
	readonly when?: When;
}

// ------------------------------------------------------------------- work

export interface CheckNode {
	readonly kind: "check";
	readonly label: string;
	readonly run: (answers: AnswerBag) => boolean | Promise<boolean>;
	/** Shown when the check fails. Omit for `optional` checks. */
	readonly fix?: string;
	/** Warn and continue instead of halting the flow. */
	readonly optional?: boolean;
	readonly when?: When;
}

export interface TaskNode {
	readonly kind: "task";
	readonly label: string;
	readonly run: (answers: AnswerBag) => unknown | Promise<unknown>;
	readonly when?: When;
}

export interface SummaryNode {
	readonly kind: "summary";
	readonly title?: string;
	/** Gate continuing on an explicit yes. Defaults to `true`. */
	readonly confirm?: boolean;
	readonly when?: When;
}

// ------------------------------------------------------------------ union

export type QuestionNode =
	| ChoiceNode<string, string, boolean>
	| MultiChoiceNode<string, string, boolean>
	| ConfirmNode<string, boolean>
	| TextNode<string, boolean>
	| SecretNode<string, boolean>
	| PickNode<string, boolean>;

export type Node =
	| WelcomeNode
	| NoteNode
	| DoneNode
	| QuestionNode
	| CheckNode
	| TaskNode
	| SummaryNode;

const QUESTION_KINDS = new Set(["choice", "multiChoice", "confirm", "text", "secret", "pick"]);

export function isQuestion(node: Node): node is QuestionNode {
	return QUESTION_KINDS.has(node.kind);
}

// -------------------------------------------------------- answer inference

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void
	? I
	: never;

type EntryOf<N> = N extends AnswerCarrier<infer Id, infer V, infer Opt>
	? Opt extends true
		? { [K in Id]?: V }
		: { [K in Id]: V }
	: never;

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/**
 * Derives the answers object from a node list — for example
 * `{ provider: "openai" | "anthropic"; apiKey?: string }`, where `apiKey`
 * is optional because its node declared a `when` guard.
 */
export type AnswersOf<Nodes extends readonly unknown[]> = Prettify<UnionToIntersection<EntryOf<Nodes[number]>>>;
