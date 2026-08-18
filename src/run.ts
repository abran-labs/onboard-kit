import * as clack from "@clack/prompts";
import { defaultStatePath, fileState, noState, type OnboardingRecord, type StateStore } from "./state.js";
import { type Accent, bold, createTheme, dim, red, type Theme } from "./theme.js";
import type { AnswerBag, AnswersOf, CheckNode, Node, QuestionNode, SummaryNode, TaskNode } from "./types.js";
import { isQuestion } from "./types.js";

/** Past this many options, `choice` becomes a filterable autocomplete. */
export const AUTOCOMPLETE_THRESHOLD = 10;

export type InteractiveMode = "auto" | "always" | "never";

/**
 * Sentinel for "no explicit answers type given".
 *
 * Left alone, `onboard()` infers the answers from the node list and callbacks
 * receive the loose bag. Pass a type — `onboard<Answers>({...})` — and every
 * `run` and `when` callback is typed against it instead.
 */
declare const INFER: unique symbol;
type Infer = typeof INFER;

/** What callbacks receive: the loose bag unless an explicit type was given. */
type CallbackArg<A> = [A] extends [Infer] ? AnswerBag : A;

/** The answers type: inferred from the nodes unless an explicit type was given. */
type Resolved<A, Nodes extends readonly unknown[]> = [A] extends [Infer] ? AnswersOf<Nodes> : A;

/**
 * Minimal sink for the template's own chrome. Defaults to stdout; point it at
 * stderr to keep stdout clean for piped output, or at a buffer in tests.
 */
export interface Output {
	write(chunk: string): unknown;
}

export interface OnboardConfig<A, Nodes extends readonly Node<A>[]> {
	/** Product name. Appears in the banner and seeds env var names. */
	readonly name: string;
	/** One of six presets. Defaults to `cyan`. */
	readonly accent?: Accent;
	/** Optional ASCII banner, rendered in the template's frame. */
	readonly logo?: string;
	/** Stable id for the onboarding record. Defaults to a slug of `name`. */
	readonly id?: string;
	/** Bump to re-ask only the questions added since. Defaults to `1`. */
	readonly version?: number;
	readonly nodes: Nodes;
	/** `false` disables the already-onboarded record entirely. */
	readonly state?: StateStore | false;
	/** Defaults to `auto`: interactive iff stdout is a TTY and not CI. */
	readonly interactive?: InteractiveMode;
	/** Throw {@link OnboardError} instead of returning a non-success result. */
	readonly throwOnFailure?: boolean;
	/** Override the environment source. For tests. */
	readonly env?: Record<string, string | undefined>;
	/** Where template chrome is written. Defaults to `process.stdout`. */
	readonly output?: Output;
}

export interface MissingInput {
	readonly id: string;
	readonly label: string;
	readonly env: string;
}

/** Outcomes where the flow reached the end without the user being blocked. */
export type OnboardSuccess<A> =
	| { readonly status: "completed"; readonly answers: A }
	/**
	 * A version bump re-asked only the questions added since the last completed
	 * run. `answers` holds just that delta — prior answers were never stored —
	 * so merge it against your existing config rather than writing it whole.
	 */
	| { readonly status: "updated"; readonly answers: Partial<A>; readonly added: readonly string[] }
	| { readonly status: "skipped"; readonly answers: A };

export type OnboardFailure<A> =
	| { readonly status: "cancelled"; readonly partial: Partial<A>; readonly atNode: string }
	| { readonly status: "blocked"; readonly failed: readonly string[] }
	| { readonly status: "needs-input"; readonly missing: readonly MissingInput[] }
	| { readonly status: "failed"; readonly error: unknown; readonly atNode: string };

export type OnboardResult<A> = OnboardSuccess<A> | OnboardFailure<A>;

/** Narrows a result to the outcomes where onboarding did not finish. */
export function isFailure<A>(result: OnboardResult<A>): result is OnboardFailure<A> {
	return (
		result.status === "cancelled" ||
		result.status === "blocked" ||
		result.status === "needs-input" ||
		result.status === "failed"
	);
}

/** Thrown instead of returning a failure when `throwOnFailure` is set. */
export class OnboardError<A = unknown> extends Error {
	readonly result: OnboardFailure<A>;

	constructor(result: OnboardFailure<A>) {
		super(describeFailure(result));
		this.name = "OnboardError";
		this.result = result;
	}
}

function describeFailure(result: OnboardFailure<unknown>): string {
	switch (result.status) {
		case "cancelled":
			return `Onboarding cancelled at "${result.atNode}".`;
		case "blocked":
			return `Onboarding blocked by failed checks: ${result.failed.join(", ")}.`;
		case "needs-input":
			return `Onboarding needs input but there is no interactive terminal. Set: ${result.missing
				.map((m) => m.env)
				.join(", ")}.`;
		case "failed":
			return `Onboarding failed at "${result.atNode}".`;
	}
}

type Answers = Record<string, unknown>;

/**
 * `MyTool` + `apiKey` -> `MYTOOL_API_KEY`
 *
 * The product name is treated as a brand token and only uppercased, while the
 * node id is a code identifier and so is split on camelCase. Splitting the
 * brand too would turn `MyTool` into the surprising `MY_TOOL_`.
 */
export function envNameFor(product: string, id: string): string {
	const clean = (s: string) =>
		s
			.replace(/[^a-zA-Z0-9]+/g, "_")
			.toUpperCase()
			.replace(/^_+|_+$/g, "");
	return `${clean(product)}_${clean(id.replace(/([a-z0-9])([A-Z])/g, "$1_$2"))}`;
}

function slug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

const CANCELLED = Symbol("cancelled");

export async function onboard<
	A = Infer,
	const Nodes extends readonly Node<CallbackArg<A>>[] = readonly Node<CallbackArg<A>>[],
	Throw extends boolean = false,
>(
	config: OnboardConfig<CallbackArg<A>, Nodes> & { readonly throwOnFailure?: Throw },
): Promise<Throw extends true ? OnboardSuccess<Resolved<A, Nodes>> : OnboardResult<Resolved<A, Nodes>>> {
	type R = Resolved<A, Nodes>;
	// With `throwOnFailure`, every failure path throws, so the only outcomes
	// that can be returned are the success ones — and the type says so.
	type Ret = Throw extends true ? OnboardSuccess<R> : OnboardResult<R>;

	const { name, accent = "cyan", logo, version = 1, nodes, interactive = "auto", env = process.env, output } = config;

	const flowId = config.id ?? slug(name);
	const theme = createTheme(accent);
	const out: Output = output ?? process.stdout;

	const isInteractive =
		interactive === "always" ? true : interactive === "never" ? false : clack.isTTY(process.stdout) && !clack.isCI();

	const store: StateStore = config.state === false ? noState() : (config.state ?? fileState(defaultStatePath(flowId)));

	const finish = (result: OnboardResult<R>): Ret => {
		if (config.throwOnFailure && isFailure(result)) throw new OnboardError(result);
		return result as Ret;
	};

	// ---- already onboarded? -------------------------------------------------
	const record = await store.read();
	let previouslyAnswered: ReadonlySet<string> = new Set();
	if (record && record.flowId === flowId) {
		if (record.version >= version) {
			return finish({ status: "skipped", answers: {} as R });
		}
		// Version bumped: ask only questions this user has never seen. Their
		// prior answers were never stored, so callbacks receive only the delta.
		previouslyAnswered = new Set(record.answered);
	}

	const answers: Answers = {};
	const failedChecks: string[] = [];
	const missing: MissingInput[] = [];
	const asked: string[] = [];

	const list = nodes as readonly Node[];
	const visible = (node: Node): boolean => node.when === undefined || node.when(answers);

	// Tracked so a thrown error can name the node that threw.
	let currentNode = "unknown";

	// Denominator for `[n/m]`, recomputed as answers arrive so that `when`
	// exclusions do not inflate it.
	const totalQuestions = (): number =>
		list.filter((n) => isQuestion(n) && visible(n) && !previouslyAnswered.has(n.id)).length;

	try {
		for (let i = 0; i < list.length; i++) {
			const node = list[i];
			if (!node || !visible(node)) continue;
			currentNode = "id" in node ? node.id : node.node;

			switch (node.node) {
				case "welcome": {
					if (!isInteractive) break;
					out.write(`${theme.header(node.title ?? name)}\n`);
					if (logo) {
						out.write(`${theme.rail()}\n`);
						for (const line of logo.split("\n")) out.write(`${theme.rail(theme.accent(line))}\n`);
					}
					if (node.subtitle) out.write(`${theme.rail()}\n${theme.rail(node.subtitle)}\n`);
					out.write(`${theme.rail()}\n`);
					break;
				}

				case "note": {
					if (!isInteractive) break;
					clack.note(node.body, node.title);
					break;
				}

				case "done": {
					if (!isInteractive) break;
					out.write(`${theme.rail()}\n`);
					out.write(`${theme.footer(node.message ?? "You're all set.")}\n`);
					if (node.next?.length) {
						out.write("\n");
						out.write(`${theme.next(node.next.map((n) => [n.cmd, n.desc ?? ""] as const))}\n`);
					}
					out.write("\n");
					break;
				}

				case "check": {
					// Consecutive checks render grouped under one header.
					const group: CheckNode<unknown>[] = [node as CheckNode<unknown>];
					while (i + 1 < list.length) {
						const peek = list[i + 1];
						if (!peek || peek.node !== "check") break;
						if (visible(peek)) group.push(peek as CheckNode<unknown>);
						i++;
					}
					const halted = await runChecks(group, answers, theme, out, isInteractive, failedChecks);
					if (halted) return finish({ status: "blocked", failed: failedChecks });
					break;
				}

				case "task": {
					await runTask(node as TaskNode<unknown>, answers, isInteractive, out);
					break;
				}

				case "summary": {
					const proceed = await runSummary(node as SummaryNode<unknown>, list, answers, theme, out, isInteractive);
					if (proceed === CANCELLED) {
						return finish({ status: "cancelled", partial: answers as Partial<R>, atNode: "summary" });
					}
					break;
				}

				default: {
					if (previouslyAnswered.has(node.id)) break;

					const value = await resolveQuestion(node, {
						out,
						isInteractive,
						product: name,
						env,
						index: asked.length + 1,
						total: totalQuestions(),
						missing,
					});

					if (value === CANCELLED) {
						return finish({ status: "cancelled", partial: answers as Partial<R>, atNode: node.id });
					}
					if (value === undefined) break; // unresolvable; recorded in `missing`

					answers[node.id] = value;
					asked.push(node.id);
				}
			}
		}
	} catch (error) {
		if (error instanceof OnboardError) throw error;
		if (isInteractive) clack.cancel(red(`Failed at ${currentNode}.`));
		return finish({ status: "failed", error, atNode: currentNode });
	}

	if (missing.length > 0) {
		reportMissing(missing, out);
		return finish({ status: "needs-input", missing });
	}

	const next: OnboardingRecord = {
		schema: 1,
		flowId,
		version,
		completedAt: new Date().toISOString(),
		answered: [...previouslyAnswered, ...asked],
	};
	await store.write(next);

	if (previouslyAnswered.size > 0) {
		return finish({ status: "updated", answers: answers as Partial<R>, added: asked });
	}
	return finish({ status: "completed", answers: answers as R });
}

// --------------------------------------------------------------- executors

async function runChecks(
	group: readonly CheckNode<unknown>[],
	answers: Answers,
	theme: Theme,
	out: Output,
	isInteractive: boolean,
	failed: string[],
): Promise<boolean> {
	if (isInteractive) out.write(`${theme.step("Checking your environment")}\n`);

	let halt = false;
	for (const node of group) {
		let ok: boolean;
		try {
			ok = await node.run(answers);
		} catch {
			ok = false;
		}

		if (ok) {
			if (isInteractive) out.write(`${theme.status("pass", node.label)}\n`);
			continue;
		}
		if (node.optional) {
			const text = node.fix ? `${node.label} — ${node.fix}` : `${node.label} — not found, skipping`;
			if (isInteractive) out.write(`${theme.status("warn", text)}\n`);
			continue;
		}
		failed.push(node.label);
		if (isInteractive) {
			out.write(`${theme.status("fail", node.label)}\n`);
			if (node.fix) out.write(`${theme.rail(dim(`   ${node.fix}`))}\n`);
		} else {
			out.write(`${node.label}: failed${node.fix ? ` — ${node.fix}` : ""}\n`);
		}
		halt = true;
	}
	if (isInteractive) out.write(`${theme.rail()}\n`);
	return halt;
}

async function runTask(node: TaskNode<unknown>, answers: Answers, isInteractive: boolean, out: Output): Promise<void> {
	if (!isInteractive) {
		await node.run(answers);
		out.write(`${node.label}: done\n`);
		return;
	}
	const spin = clack.spinner();
	spin.start(node.label);
	try {
		await node.run(answers);
		spin.stop(node.label);
	} catch (error) {
		spin.error(`${node.label} — failed`);
		throw error;
	}
}

async function runSummary(
	node: SummaryNode<unknown>,
	nodes: readonly Node[],
	answers: Answers,
	theme: Theme,
	out: Output,
	isInteractive: boolean,
): Promise<true | typeof CANCELLED> {
	const rows: (readonly [string, string])[] = [];
	for (const n of nodes) {
		if (!isQuestion(n)) continue;
		if (!(n.id in answers)) continue;
		rows.push([n.label, n.node === "secret" ? dim("•••••  (hidden)") : formatValue(answers[n.id])]);
	}
	if (rows.length === 0) return true;

	if (!isInteractive) {
		// Non-interactive runs echo the plan but never gate on a confirmation
		// that nobody is there to give.
		for (const [key, value] of rows) out.write(`${key}: ${value}\n`);
		return true;
	}

	out.write(`${theme.divider(node.title ?? "Review")}\n`);
	out.write(`${theme.rail()}\n`);
	out.write(`${theme.rows(rows)}\n`);
	out.write(`${theme.rail()}\n`);

	if (node.confirm === false) return true;

	const ok = await clack.confirm({ message: "Apply these changes?" });
	if (clack.isCancel(ok) || ok === false) {
		clack.cancel("Cancelled — nothing was changed.");
		return CANCELLED;
	}
	return true;
}

interface QuestionCtx {
	readonly out: Output;
	readonly isInteractive: boolean;
	readonly product: string;
	readonly env: Record<string, string | undefined>;
	readonly index: number;
	readonly total: number;
	readonly missing: MissingInput[];
}

async function resolveQuestion(node: QuestionNode, ctx: QuestionCtx): Promise<unknown | typeof CANCELLED> {
	const envName = envNameFor(ctx.product, node.id);
	const fromEnv = ctx.env[envName];

	if (fromEnv !== undefined && fromEnv !== "") return coerce(node, fromEnv);

	if (!ctx.isInteractive) {
		const fallback = "default" in node ? node.default : undefined;
		if (fallback !== undefined) return fallback;
		ctx.missing.push({ id: node.id, label: node.label, env: envName });
		return undefined;
	}

	const counter = ctx.total > 1 ? `${dim(`[${ctx.index}/${ctx.total}]`)}  ` : "";
	const value = await promptFor(node, `${counter}${node.label}`);
	if (clack.isCancel(value)) {
		clack.cancel("Cancelled.");
		return CANCELLED;
	}
	return value;
}

async function promptFor(node: QuestionNode, message: string): Promise<unknown> {
	switch (node.node) {
		case "choice": {
			const options = toClackOptions(node.options);
			return node.options.length > AUTOCOMPLETE_THRESHOLD
				? clack.autocomplete({ message, options })
				: clack.select({ message, options, ...(node.default !== undefined ? { initialValue: node.default } : {}) });
		}
		case "multiChoice":
			return clack.multiselect({
				message,
				options: toClackOptions(node.options),
				...(node.default !== undefined ? { initialValues: [...node.default] } : {}),
				required: (node.min ?? 0) > 0,
			});
		case "confirm":
			return clack.confirm({ message, ...(node.default !== undefined ? { initialValue: node.default } : {}) });
		case "text":
			return clack.text({
				message,
				...(node.placeholder !== undefined ? { placeholder: node.placeholder } : {}),
				...(node.default !== undefined ? { defaultValue: node.default } : {}),
				...(node.validate ? { validate: wrapValidate(node.validate) } : {}),
			});
		case "secret":
			return clack.password({
				message,
				...(node.validate ? { validate: wrapValidate(node.validate) } : {}),
			});
		case "pick":
			return clack.path({
				message,
				...(node.root !== undefined ? { root: node.root } : {}),
				directory: node.select === "directory",
			});
	}
}

function toClackOptions(options: readonly { value: string; label?: string; hint?: string }[]) {
	return options.map((o) => ({
		value: o.value,
		...(o.label !== undefined ? { label: o.label } : {}),
		...(o.hint !== undefined ? { hint: o.hint } : {}),
	}));
}

/** Adapts our `string | true` validator to clack's `string | undefined`. */
function wrapValidate(fn: (value: string) => string | true) {
	return (value: string | undefined): string | undefined => {
		if (typeof value !== "string") return "Required";
		const result = fn(value);
		return result === true ? undefined : result;
	};
}

function coerce(node: QuestionNode, raw: string): unknown {
	switch (node.node) {
		case "confirm":
			return raw !== "0" && raw.toLowerCase() !== "false" && raw.toLowerCase() !== "no";
		case "multiChoice":
			return raw
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		default:
			return raw;
	}
}

function formatValue(value: unknown): string {
	if (Array.isArray(value)) return value.length ? value.join(", ") : dim("none");
	if (typeof value === "boolean") return value ? "yes" : "no";
	if (value === undefined || value === "") return dim("unset");
	return String(value);
}

function reportMissing(missing: readonly MissingInput[], out: Output): void {
	out.write(`\n${red("Cannot continue without input.")}\n`);
	out.write("No interactive terminal, and these have no value or default:\n\n");
	for (const m of missing) out.write(`  ${bold(m.label)}\n    set ${m.env}\n`);
	out.write("\n");
}
