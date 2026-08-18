import * as clack from "@clack/prompts";
import type { AnswersOf, CheckNode, Node, QuestionNode, SummaryNode, TaskNode } from "./types.js";
import { isQuestion } from "./types.js";
import { defaultStatePath, fileState, noState, type OnboardingRecord, type StateStore } from "./state.js";
import { type Accent, bold, createTheme, dim, red, type Theme } from "./theme.js";

/** Past this many options, `choice` becomes a filterable autocomplete. */
export const AUTOCOMPLETE_THRESHOLD = 10;

export type InteractiveMode = "auto" | "always" | "never";

export interface OnboardConfig<Nodes extends readonly Node[]> {
	/** Product name. Appears in the banner and seeds env var names. */
	readonly name: string;
	/** One of six presets. Defaults to `cyan`. */
	readonly accent?: Accent;
	/** Optional ASCII banner, rendered in the template's frame. */
	readonly logo?: string;
	/** Stable id for the onboarding record. Defaults to a slug of `name`. */
	readonly id?: string;
	/** Bump to re-run only the question nodes added since. Defaults to `1`. */
	readonly version?: number;
	readonly nodes: Nodes;
	/** `false` disables the already-onboarded record entirely. */
	readonly state?: StateStore | false;
	/** Defaults to `auto`: interactive iff stdout is a TTY and not CI. */
	readonly interactive?: InteractiveMode;
	/** Override the environment source. For tests. */
	readonly env?: Record<string, string | undefined>;
	/** Where template chrome is written. Defaults to `process.stdout`. */
	readonly output?: Output;
}

export type OnboardResult<A> =
	| { readonly status: "completed"; readonly answers: A }
	/**
	 * A version bump re-ran only the questions added since the last completed
	 * run. `answers` holds just that delta — prior answers were never stored —
	 * so merge it against your existing config rather than writing it whole.
	 */
	| { readonly status: "updated"; readonly answers: Partial<A>; readonly added: readonly string[] }
	| { readonly status: "skipped"; readonly answers: A }
	| { readonly status: "cancelled"; readonly partial: Partial<A>; readonly atNode: string }
	| { readonly status: "blocked"; readonly failed: readonly string[] }
	| { readonly status: "needs-input"; readonly missing: readonly MissingInput[] }
	| { readonly status: "failed"; readonly error: unknown; readonly atNode: string };

export interface MissingInput {
	readonly id: string;
	readonly label: string;
	readonly env: string;
}

type Answers = Record<string, unknown>;

/**
 * Minimal sink for the template's own chrome. Defaults to stdout; point it at
 * stderr to keep stdout clean for piped output, or at a buffer in tests.
 */
export interface Output {
	write(chunk: string): unknown;
}

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

export async function onboard<const Nodes extends readonly Node[]>(
	config: OnboardConfig<Nodes>,
): Promise<OnboardResult<AnswersOf<Nodes>>> {
	type A = AnswersOf<Nodes>;
	const {
		name,
		accent = "cyan",
		logo,
		version = 1,
		nodes,
		interactive = "auto",
		env = process.env,
		output,
	} = config;

	const flowId = config.id ?? slug(name);
	const theme = createTheme(accent);
	const out: Output = output ?? process.stdout;

	const isInteractive =
		interactive === "always"
			? true
			: interactive === "never"
				? false
				: clack.isTTY(process.stdout) && !clack.isCI();

	const store: StateStore =
		config.state === false ? noState() : (config.state ?? fileState(defaultStatePath(flowId)));

	// ---- already onboarded? -------------------------------------------------
	const record = await store.read();
	let previouslyAnswered: ReadonlySet<string> = new Set();
	if (record && record.flowId === flowId) {
		if (record.version >= version) {
			return { status: "skipped", answers: {} as A };
		}
		// Version bumped: ask only questions this user has never seen. Their
		// prior answers were never stored, so `run` callbacks receive only the
		// delta — merge against your own config on the consumer side.
		previouslyAnswered = new Set(record.answered);
	}

	const answers: Answers = {};
	const failedChecks: string[] = [];
	const missing: MissingInput[] = [];
	const asked: string[] = [];

	const visible = (node: Node): boolean => node.when === undefined || node.when(answers);

	// Tracked so a thrown error can name the node that threw.
	let currentNode = "unknown";

	// Denominator for `[n/m]`, recomputed as answers arrive so that `when`
	// exclusions do not inflate it.
	const totalQuestions = (): number =>
		nodes.filter((n) => isQuestion(n) && visible(n) && !previouslyAnswered.has(n.id)).length;

	try {
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (!node || !visible(node)) continue;
			currentNode = "id" in node ? node.id : node.kind;

			switch (node.kind) {
				case "welcome": {
					if (!isInteractive) break;
					out.write(`${theme.header(node.title ?? name)}\n`);
					if (logo) {
						out.write(`${theme.rail()}\n`);
						for (const line of logo.split("\n")) out.write(`${theme.rail(theme.accent(line))}\n`);
					}
					if (node.subtitle) {
						out.write(`${theme.rail()}\n${theme.rail(node.subtitle)}\n`);
					}
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
					const group: CheckNode[] = [node];
					while (i + 1 < nodes.length) {
						const peek = nodes[i + 1];
						if (!peek || peek.kind !== "check") break;
						if (visible(peek)) group.push(peek);
						i++;
					}
					const halted = await runChecks(group, answers, theme, out, isInteractive, failedChecks);
					if (halted) return { status: "blocked", failed: failedChecks };
					break;
				}

				case "task": {
					await runTask(node, answers, isInteractive, out);
					break;
				}

				case "summary": {
					const proceed = await runSummary(node, nodes, answers, theme, out, isInteractive);
					if (proceed === CANCELLED) {
						return { status: "cancelled", partial: answers as Partial<A>, atNode: "summary" };
					}
					break;
				}

				default: {
					if (previouslyAnswered.has(node.id)) break;

					const index = asked.length + 1;
					const value = await resolveQuestion(node, {
						theme,
						out,
						isInteractive,
						product: name,
						env,
						index,
						total: totalQuestions(),
						missing,
					});

					if (value === CANCELLED) {
						return { status: "cancelled", partial: answers as Partial<A>, atNode: node.id };
					}
					if (value === undefined) break; // unresolvable; recorded in `missing`

					answers[node.id] = value;
					asked.push(node.id);
				}
			}
		}
	} catch (error) {
		if (isInteractive) clack.cancel(red(`Failed at ${currentNode}.`));
		return { status: "failed", error, atNode: currentNode };
	}

	if (missing.length > 0) {
		reportMissing(missing, out);
		return { status: "needs-input", missing };
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
		return { status: "updated", answers: answers as Partial<A>, added: asked };
	}
	return { status: "completed", answers: answers as A };
}

// --------------------------------------------------------------- executors

async function runChecks(
	group: readonly CheckNode[],
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

async function runTask(
	node: TaskNode,
	answers: Answers,
	isInteractive: boolean,
	out: Output,
): Promise<void> {
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
	node: SummaryNode,
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
		rows.push([n.label, n.kind === "secret" ? dim("•••••  (hidden)") : formatValue(answers[n.id])]);
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
	readonly theme: Theme;
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

	if (fromEnv !== undefined && fromEnv !== "") {
		return coerce(node, fromEnv);
	}

	if (!ctx.isInteractive) {
		const fallback = "default" in node ? node.default : undefined;
		if (fallback !== undefined) return fallback;
		ctx.missing.push({ id: node.id, label: node.label, env: envName });
		return undefined;
	}

	const counter = ctx.total > 1 ? `${dim(`[${ctx.index}/${ctx.total}]`)}  ` : "";
	const message = `${counter}${node.label}`;
	const value = await promptFor(node, message);
	if (clack.isCancel(value)) {
		clack.cancel("Cancelled.");
		return CANCELLED;
	}
	return value;
}

async function promptFor(node: QuestionNode, message: string): Promise<unknown> {
	switch (node.kind) {
		case "choice": {
			const options = node.options.map((o) => ({
				value: o.value,
				...(o.label !== undefined ? { label: o.label } : {}),
				...(o.hint !== undefined ? { hint: o.hint } : {}),
			}));
			return node.options.length > AUTOCOMPLETE_THRESHOLD
				? clack.autocomplete({ message, options })
				: clack.select({ message, options, ...(node.default !== undefined ? { initialValue: node.default } : {}) });
		}
		case "multiChoice": {
			const options = node.options.map((o) => ({
				value: o.value,
				...(o.label !== undefined ? { label: o.label } : {}),
				...(o.hint !== undefined ? { hint: o.hint } : {}),
			}));
			return clack.multiselect({
				message,
				options,
				...(node.default !== undefined ? { initialValues: [...node.default] } : {}),
				required: (node.min ?? 0) > 0,
			});
		}
		case "confirm":
			return clack.confirm({
				message,
				...(node.default !== undefined ? { initialValue: node.default } : {}),
			});
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

/** Adapts our `string | true` validator to clack's `string | undefined`. */
function wrapValidate(fn: (value: string) => string | true) {
	return (value: string | undefined): string | undefined => {
		if (typeof value !== "string") return "Required";
		const result = fn(value);
		return result === true ? undefined : result;
	};
}

function coerce(node: QuestionNode, raw: string): unknown {
	switch (node.kind) {
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
	for (const m of missing) {
		out.write(`  ${bold(m.label)}\n    set ${m.env}\n`);
	}
	out.write("\n");
}
