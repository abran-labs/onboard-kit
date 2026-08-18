import { expect, test } from "bun:test";
import { onboard } from "./run.js";
import type { AnswersOf, Node } from "./types.js";

/**
 * Type-level contract, checked by `bun run check` rather than at runtime.
 *
 * A `@ts-expect-error` that stops firing is itself a compile error, so this
 * file fails loudly if the inference ever regresses.
 */

const nodes = [
	{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }, { value: "anthropic" }] },
	{ node: "secret", id: "apiKey", label: "API key", when: (a) => a.provider !== "local" },
	{ node: "confirm", id: "telemetry", label: "Telemetry" },
	{ node: "multiChoice", id: "features", label: "Features", options: [{ value: "sync" }, { value: "cloud" }] },
] as const satisfies readonly Node[];

type A = AnswersOf<typeof nodes>;

/** Never called: it exists so `tsc` checks the assertions in its body. */
function _inferredAnswers(a: A): void {
	// `choice` narrows to the union of its declared option values.
	const _provider: "openai" | "anthropic" = a.provider;

	// A `when`-guarded node yields an optional key: it may never be asked.
	const _apiKey: string | undefined = a.apiKey;

	const _telemetry: boolean = a.telemetry;
	const _features: ("sync" | "cloud")[] = a.features;

	// @ts-expect-error guarded answers are optional and must be narrowed first
	const _requiredApiKey: string = a.apiKey;

	// @ts-expect-error provider is the whole option union, not a single member
	const _oneProvider: "openai" = a.provider;

	// @ts-expect-error unknown ids are not present on the inferred answers
	const _missing = a.notARealId;

	void [_provider, _apiKey, _telemetry, _features, _requiredApiKey, _oneProvider, _missing];
}

/**
 * The payoff of object literals over constructor calls: passing an explicit
 * answers type flows contextual typing into every `run` and `when` callback.
 * A constructor-based API cannot do this, because the call resolves its own
 * generics before `onboard` ever sees the array.
 */
type Explicit = { provider: "openai" | "anthropic"; apiKey: string };

function _typedCallbacks(): void {
	void onboard<Explicit>({
		name: "MyTool",
		interactive: "never",
		state: false,
		nodes: [
			{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
			{
				node: "task",
				label: "Write",
				run: (a) => {
					const _ok: "openai" | "anthropic" = a.provider;
					// @ts-expect-error the callback is typed, so unknown keys fail
					a.notARealId;
					// @ts-expect-error and so do wrong value types
					const _bad: number = a.provider;
					void [_ok, _bad];
				},
			},
			{
				node: "check",
				label: "probe",
				run: (a) => a.apiKey.length > 0,
				when: (a) => a.provider === "openai",
			},
		],
	});
}

void _inferredAnswers;
void _typedCallbacks;

test("nodes are plain data with no hidden fields", () => {
	const node = { node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] } as const;
	expect(Object.keys(node).sort()).toEqual(["id", "label", "node", "options"]);
	expect(JSON.parse(JSON.stringify(node))).toEqual(node as unknown as Record<string, unknown>);
});

/**
 * `throwOnFailure` narrows the result to the success outcomes, since every
 * failure path throws. All three carry `answers`, so it destructures.
 */
async function _throwOnFailureNarrows(): Promise<void> {
	const { answers } = await onboard({
		name: "MyTool",
		interactive: "never",
		state: false,
		throwOnFailure: true,
		nodes: [{ node: "choice", id: "provider", label: "P", options: [{ value: "openai" }] }],
	});
	const _p: "openai" | undefined = answers.provider;

	const loose = await onboard({
		name: "MyTool",
		interactive: "never",
		state: false,
		nodes: [{ node: "choice", id: "provider", label: "P", options: [{ value: "openai" }] }],
	});
	// @ts-expect-error without throwOnFailure the union still includes failures
	loose.answers;

	void [_p];
}

void _throwOnFailureNarrows;
