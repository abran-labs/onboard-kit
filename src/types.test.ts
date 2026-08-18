import { expect, test } from "bun:test";
import { choice, confirm, multiChoice, secret } from "./nodes.js";
import type { AnswersOf } from "./types.js";

/**
 * Type-level contract for `AnswersOf`.
 *
 * These assertions are checked by `bun run check`, not at runtime — the point
 * is that the inferred answers object is honest about what a flow produces.
 * A `@ts-expect-error` that stops firing is itself a compile error, so this
 * file fails loudly if the inference ever regresses.
 */

const nodes = [
	choice({
		id: "provider",
		label: "Provider",
		options: [{ value: "openai" }, { value: "anthropic" }],
	}),
	secret({ id: "apiKey", label: "API key", when: (a) => a.provider !== "local" }),
	confirm({ id: "telemetry", label: "Telemetry" }),
	multiChoice({
		id: "features",
		label: "Features",
		options: [{ value: "sync" }, { value: "cloud" }],
	}),
] as const;

type A = AnswersOf<typeof nodes>;

/**
 * Never called. It exists so that `tsc` checks the assertions in its body
 * while `bun test` executes nothing — the assertions are the test.
 */
function _typeContract(a: A): void {
	// `choice` narrows to the union of its declared option values.
	const _provider: "openai" | "anthropic" = a.provider;

	// A `when`-guarded node yields an optional key, because it may never be asked.
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

void _typeContract;

test("node constructors produce inert descriptors", () => {
	const node = choice({ id: "provider", label: "Provider", options: [{ value: "openai" }] });
	expect({ ...node } as Record<string, unknown>).toEqual({
		kind: "choice",
		id: "provider",
		label: "Provider",
		options: [{ value: "openai" }],
	});
	// Phantom fields exist only in the type, never at runtime.
	expect(Object.keys(node)).not.toContain("__value");
	expect(Object.keys(node)).not.toContain("__optional");
});
