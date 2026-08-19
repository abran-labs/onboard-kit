import { dirname } from "node:path";
import * as clack from "@clack/prompts";
import {
	currentTty,
	defaultResumePath,
	defaultStatePath,
	fileResume,
	fileState,
	noState,
	sweepClosedResumes,
	type OnboardingRecord,
	type ResumeStore,
	type StateStore,
} from "./state.js";
import { type Accent, bold, createTheme, dim, red, type Theme } from "./theme.js";
import { wordmark, wordmarkCorner } from "./wordmark.js";
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
	/**
	 * Opt-in brand colour for the title and `Next` commands. Omit for entirely
	 * monochrome chrome, which is the default and adapts to any terminal theme.
	 */
	readonly accent?: Accent;
	/**
	 * A wordmark above the rail. `true` renders `name` in the template's block
	 * font; a string is used verbatim, so you can supply your own ASCII art.
	 *
	 * When set, it replaces the header rule rather than sitting above it — the
	 * wordmark is the title, and printing both just says the name twice.
	 */
	readonly logo?: string | true;
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
	/**
	 * Save progress when the user cancels, so the flow can be resumed.
	 *
	 * Saved to the runtime directory — RAM-backed and cleared on logout — and
	 * deleted on completion. Secret answers are never saved and are re-asked
	 * on resume. Off by default, since it does persist real answers.
	 */
	readonly resumable?: boolean;
	/** Pick up a previously cancelled run instead of starting over. */
	readonly resume?: boolean;
	/** The command printed in the resume hint, e.g. `mytool setup --resume`. */
	readonly resumeCommand?: string;
	/** Override the resume store. For tests. */
	readonly resumeStore?: ResumeStore;
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

	const { name, accent, logo, version = 1, nodes, interactive = "auto", env = process.env, output } = config;

	const flowId = config.id ?? slug(name);
	const theme = createTheme(accent);
	const sink: Output = output ?? process.stdout;
	// Every block opens with a blank rail so they are evenly separated. The
	// first one is different: with no banner above it there is no rail yet to
	// continue, and the lone `│` reads as a stray mark. So track whether
	// anything has been drawn, and let the first block start flush.
	let drawn = false;
	const out: Output = {
		write(chunk) {
			drawn = true;
			return sink.write(chunk);
		},
	};
	/** A blank rail between blocks — nothing at all before the first one. */
	const gap = (): void => {
		if (drawn) out.write(`${theme.rail()}\n`);
	};

	const isInteractive =
		interactive === "always" ? true : interactive === "never" ? false : clack.isTTY(process.stdout) && !clack.isCI();

	const store: StateStore = config.state === false ? noState() : (config.state ?? fileState(defaultStatePath(flowId)));
	const resumeStore: ResumeStore = config.resumeStore ?? fileResume(defaultResumePath(flowId));
	// Earliest chance to clear progress whose terminal has since closed.
	if (config.resumeStore === undefined) {
		void sweepClosedResumes(dirname(defaultResumePath(flowId)));
	}

	/**
	 * Single exit point: persists or clears resume state, then either returns
	 * the result or throws it, depending on `throwOnFailure`.
	 */
	const finish = async (result: OnboardResult<R>): Promise<Ret> => {
		// A crashed task is as worth resuming as a Ctrl-C: the answers are all
		// collected and only the work failed. `blocked` is excluded on purpose —
		// that means the machine is not ready, and the checks re-run anyway.
		const worthResuming = result.status === "cancelled" || result.status === "failed";
		if (worthResuming && config.resumable) {
			await saveResume();
		} else if (result.status === "completed" || result.status === "updated") {
			// Progress is no longer partial, so the partial copy must go.
			await resumeStore.clear().catch(() => {});
		}
		if (config.throwOnFailure && isFailure(result)) throw new OnboardError(result);
		return result as Ret;
	};

	/**
	 * Drops progress saved by an earlier run, once this run reaches its first
	 * question without `resume`.
	 *
	 * Waiting for the first question rather than doing it at startup matters:
	 * someone who forgets `--resume` and immediately quits keeps what they had,
	 * while someone who actually answers something has chosen to start over. It
	 * also covers the runs that never reach a save — blocked by a failed check,
	 * or killed — which would otherwise leave the old answers resumable.
	 */
	async function discardStaleProgress(): Promise<void> {
		if (discarded || config.resume) return;
		discarded = true;
		await resumeStore.clear().catch(() => {});
	}

	/** Writes non-secret answers so a cancelled run can be picked up again. */
	async function saveResume(): Promise<void> {
		const secretIds = new Set(list.filter((n) => n.node === "secret").map((n) => n.id));
		const keep = Object.fromEntries(Object.entries(answers).filter(([id]) => !secretIds.has(id)));
		if (Object.keys(keep).length === 0) return;

		try {
			await resumeStore.write({
				schema: 1,
				flowId,
				version,
				savedAt: new Date().toISOString(),
				...(() => {
					const tty = currentTty();
					return tty ? { ownerTty: tty.path, ownerTtyIno: tty.ino } : {};
				})(),
				answers: keep,
			});
		} catch {
			// A machine that will not let us write a scratch file is not a reason
			// to fail the run — the user simply starts over next time.
			return;
		}

		if (!isInteractive) return;
		const command = config.resumeCommand ?? `${slug(name)} --resume`;
		// The rail is already closed by the cancel line above, so this sits
		// below it as a compact two-column block.
		out.write("\n");
		out.write(`${theme.trailing([["Resume", command]])}\n`);
		out.write("\n");
	}

	// ---- already onboarded? -------------------------------------------------
	const record = await store.read();
	let previouslyAnswered: ReadonlySet<string> = new Set();
	if (record && record.flowId === flowId) {
		if (record.version >= version) {
			return await finish({ status: "skipped", answers: {} as R });
		}
		// Version bumped: ask only questions this user has never seen. Their
		// prior answers were never stored, so callbacks receive only the delta.
		previouslyAnswered = new Set(record.answered);
	}

	const answers: Answers = {};
	// Set once a fresh run commits to starting over. See discardStaleProgress.
	let discarded = false;
	// Answers restored from a cancelled run. Secrets are never among them, so
	// those questions are asked again below.
	let restored: readonly string[] = [];
	if (config.resume) {
		const saved = await resumeStore.read();
		if (saved && saved.flowId === flowId && saved.version === version) {
			Object.assign(answers, saved.answers);
			restored = Object.keys(saved.answers);
		}
	}

	const failedChecks: string[] = [];
	const missing: MissingInput[] = [];
	const asked: string[] = [];

	const list = nodes as readonly Node[];
	const visible = (node: Node): boolean => node.when === undefined || node.when(answers);

	// Tracked so a thrown error can name the node that threw.
	let currentNode = "unknown";
	// Counts every question this run covers, replayed or asked, so a resumed
	// flow numbers its steps exactly as the original did.
	let questionNo = 0;

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
					// The wordmark rides three half-cells above the frame corner, so the
					// letters lead and the rail joins them a line and a half down.
					const LIFT_HALVES = 3;
					const art =
						logo === true
							? wordmark(node.title ?? name, {
									scale: 1,
									halfStep: LIFT_HALVES % 2 === 1,
									...(theme.accentCode !== undefined ? { accentCode: theme.accentCode } : {}),
								})
							: logo
								? logo.split("\n").map(theme.accent)
								: [];
					if (art.length > 0) {
						// logo() opens the frame itself, partway down the block.
						out.write(`${theme.logo(art, logo === true ? wordmarkCorner(LIFT_HALVES) : 0)}\n`);
					} else {
						// A wordmark leads with its own overhanging rows, so it needs no
						// run-up. A one-line header has none, and sits on the shell prompt
						// without one.
						out.write(`\n${theme.header(node.title ?? name)}\n`);
					}
					if (node.subtitle) {
						// One rail of air between the wordmark and the blurb. Lines are
						// written through untouched so the caller's own styling survives.
						out.write(`${theme.rail()}\n`);
						for (const line of node.subtitle.split("\n")) {
							out.write(`${line === "" ? theme.rail() : theme.rail(line)}\n`);
						}
					}
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
					const halted = await runChecks(group, answers, theme, out, gap, isInteractive, failedChecks);
					if (halted) return await finish({ status: "blocked", failed: failedChecks });
					break;
				}

				case "task": {
					await runTask(node as TaskNode<unknown>, answers, isInteractive, out);
					break;
				}

				case "summary": {
					const proceed = await runSummary(node as SummaryNode<unknown>, list, answers, theme, out, isInteractive);
					if (proceed === CANCELLED) {
						return await finish({ status: "cancelled", partial: answers as Partial<R>, atNode: "summary" });
					}
					break;
				}

				default: {
					if (previouslyAnswered.has(node.id)) break;
					questionNo += 1;
					await discardStaleProgress();
					if (restored.includes(node.id)) {
						// Redraw it as an answered prompt, counter and all. Skipping
						// silently made a resumed run look like it had lost the
						// earlier answers, and dropping the counter made the
						// remaining steps look misnumbered.
						if (isInteractive) {
							// Clack opens every prompt with a blank rail and closes with
							// the value — no trailing blank. Matching that exactly is
							// what keeps a replayed question spaced like a real one.
							out.write(`${theme.rail()}\n`);
							out.write(`${theme.step(numbered(questionNo, totalQuestions(), node.label))}\n`);
							out.write(`${theme.rail(dim(displayValue(node, answers[node.id])))}\n`);
						}
						break;
					}

					const value = await resolveQuestion(node, {
						out,
						isInteractive,
						product: name,
						env,
						index: questionNo,
						total: totalQuestions(),
						missing,
					});

					if (value === CANCELLED) {
						return await finish({ status: "cancelled", partial: answers as Partial<R>, atNode: node.id });
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
		return await finish({ status: "failed", error, atNode: currentNode });
	}

	if (missing.length > 0) {
		reportMissing(missing, out);
		return await finish({ status: "needs-input", missing });
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
		return await finish({ status: "updated", answers: answers as Partial<R>, added: asked });
	}
	return await finish({ status: "completed", answers: answers as R });
}

// --------------------------------------------------------------- executors

async function runChecks(
	group: readonly CheckNode<unknown>[],
	answers: Answers,
	theme: Theme,
	out: Output,
	gap: () => void,
	isInteractive: boolean,
	failed: string[],
): Promise<boolean> {
	// Leading blank rail, no trailing one — the same shape clack gives a prompt,
	// so every block in the flow is separated by exactly one rail line.
	if (isInteractive) {
		gap();
		out.write(`${theme.step("Checking your environment")}\n`);
	}

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
		rows.push([n.label, n.node === "secret" ? dim("•••••  (hidden)") : displayValue(n, answers[n.id])]);
	}
	if (rows.length === 0) return true;

	if (!isInteractive) {
		// Non-interactive runs echo the plan but never gate on a confirmation
		// that nobody is there to give.
		for (const [key, value] of rows) out.write(`${key}: ${value}\n`);
		return true;
	}

	out.write(`${theme.rail()}\n`);
	out.write(`${theme.divider(node.title ?? "Review")}\n`);
	out.write(`${theme.rail()}\n`);
	out.write(`${theme.rows(rows)}\n`);

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

	const value = await promptFor(node, numbered(ctx.index, ctx.total, node.label));
	if (clack.isCancel(value)) {
		clack.cancel("Cancelled.");
		return CANCELLED;
	}
	return value;
}

/** `[2/3]  API key` — omitted when there is only one question to ask. */
export function numbered(index: number, total: number, label: string): string {
	return total > 1 ? `${dim(`[${index}/${total}]`)}  ${label}` : label;
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
				required: node.required ?? false,
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

/**
 * Renders an answer the way the user chose it.
 *
 * `choice` and `multiChoice` store the option `value`, but the user picked a
 * `label` — showing the raw value made the review contradict the prompt
 * ("OpenAI" selected, "openai" reviewed).
 */
function displayValue(node: QuestionNode, value: unknown): string {
	if (node.node === "choice" || node.node === "multiChoice") {
		const labelFor = (v: unknown) => node.options.find((o) => o.value === v)?.label ?? String(v);
		return Array.isArray(value)
			? value.length
				? value.map(labelFor).join(", ")
				: dim("none")
			: labelFor(value);
	}
	return formatValue(value);
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
