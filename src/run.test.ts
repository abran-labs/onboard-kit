import { describe, expect, test } from "bun:test";
import { check, choice, confirm, done, multiChoice, secret, summary, task, welcome } from "./nodes.js";
import { envNameFor, onboard, type Output } from "./run.js";
import { memoryState } from "./state.js";

/**
 * The engine is exercised entirely in non-interactive mode, which is also the
 * mode CI users hit — so these tests cover the path most likely to be broken
 * and least likely to be manually noticed.
 */

function sink(): Output & { text: string } {
	const chunks: string[] = [];
	return {
		write(chunk: string) {
			chunks.push(chunk);
			return true;
		},
		get text() {
			return chunks.join("");
		},
	};
}

const base = { name: "MyTool", interactive: "never", output: sink() } as const;

describe("envNameFor", () => {
	test("converts product and camelCase id to SCREAMING_SNAKE", () => {
		expect(envNameFor("MyTool", "apiKey")).toBe("MYTOOL_API_KEY");
		expect(envNameFor("my-tool", "provider")).toBe("MY_TOOL_PROVIDER");
		expect(envNameFor("Acme CLI", "postOutputCommand")).toBe("ACME_CLI_POST_OUTPUT_COMMAND");
	});
});

describe("non-interactive resolution", () => {
	test("reads answers from environment variables", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: { MYTOOL_PROVIDER: "anthropic", MYTOOL_API_KEY: "sk-live" },
			nodes: [
				choice({
					id: "provider",
					label: "Provider",
					options: [{ value: "openai" }, { value: "anthropic" }],
				}),
				secret({ id: "apiKey", label: "API key" }),
			],
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers).toEqual({ provider: "anthropic", apiKey: "sk-live" });
	});

	test("falls back to declared defaults", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: {},
			nodes: [
				choice({
					id: "provider",
					label: "Provider",
					options: [{ value: "openai" }, { value: "anthropic" }],
					default: "openai",
				}),
			],
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers.provider).toBe("openai");
	});

	test("reports needs-input naming the exact env var, rather than hanging", async () => {
		const out = sink();
		const result = await onboard({
			name: "MyTool",
			interactive: "never",
			output: out,
			state: false,
			env: {},
			nodes: [secret({ id: "apiKey", label: "API key" })],
		});

		expect(result.status).toBe("needs-input");
		if (result.status !== "needs-input") return;
		expect(result.missing).toEqual([{ id: "apiKey", label: "API key", env: "MYTOOL_API_KEY" }]);
		expect(out.text).toContain("MYTOOL_API_KEY");
	});

	test("coerces confirm and multiChoice from string env values", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: { MYTOOL_TELEMETRY: "false", MYTOOL_FEATURES: "a, b" },
			nodes: [
				confirm({ id: "telemetry", label: "Telemetry" }),
				multiChoice({
					id: "features",
					label: "Features",
					options: [{ value: "a" }, { value: "b" }, { value: "c" }],
				}),
			],
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers.telemetry).toBe(false);
		expect(result.answers.features).toEqual(["a", "b"]);
	});
});

describe("when()", () => {
	test("skips nodes whose condition is false", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: { MYTOOL_PROVIDER: "local" },
			nodes: [
				choice({
					id: "provider",
					label: "Provider",
					options: [{ value: "local" }, { value: "openai" }],
				}),
				secret({
					id: "apiKey",
					label: "API key",
					when: (a) => a.provider !== "local",
				}),
			],
		});

		// apiKey is skipped, so its absence must not surface as needs-input —
		// and its key is optional in the inferred type, since it is guarded.
		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers).toEqual({ provider: "local" });
		expect(result.answers.apiKey).toBeUndefined();
	});
});

describe("check()", () => {
	test("a failed required check blocks the flow before any task runs", async () => {
		let taskRan = false;
		const result = await onboard({
			...base,
			state: false,
			env: {},
			nodes: [
				check({ label: "Node 20+", run: () => true }),
				check({ label: "git", run: () => false, fix: "Install git" }),
				task({ label: "Write config", run: () => { taskRan = true; } }),
			],
		});

		expect(result.status).toBe("blocked");
		if (result.status !== "blocked") return;
		expect(result.failed).toEqual(["git"]);
		expect(taskRan).toBe(false);
	});

	test("an optional check warns and continues", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: {},
			nodes: [check({ label: "git", run: () => false, optional: true })],
		});

		expect(result.status).toBe("completed");
	});

	test("a check that throws counts as a failure, not a crash", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: {},
			nodes: [
				check({
					label: "probe",
					run: () => {
						throw new Error("boom");
					},
				}),
			],
		});

		expect(result.status).toBe("blocked");
	});
});

describe("task()", () => {
	test("receives the collected answers", async () => {
		let seen: unknown;
		await onboard({
			...base,
			state: false,
			env: { MYTOOL_PROVIDER: "openai" },
			nodes: [
				choice({ id: "provider", label: "Provider", options: [{ value: "openai" }] }),
				task({ label: "Write", run: (a) => { seen = a; } }),
			],
		});

		expect(seen).toEqual({ provider: "openai" });
	});

	test("a throwing task fails the flow and names the node", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: {},
			nodes: [task({ label: "Write config", run: () => { throw new Error("disk full"); } })],
		});

		expect(result.status).toBe("failed");
		if (result.status !== "failed") return;
		expect(result.atNode).toBe("task");
		expect((result.error as Error).message).toBe("disk full");
	});
});

describe("onboarding state", () => {
	test("a completed flow is skipped on the next run", async () => {
		const state = memoryState();
		const nodes = [
			choice({ id: "provider", label: "Provider", options: [{ value: "openai" }] }),
		];
		const env = { MYTOOL_PROVIDER: "openai" };

		const first = await onboard({ ...base, state, env, nodes });
		const second = await onboard({ ...base, state, env, nodes });

		expect(first.status).toBe("completed");
		expect(second.status).toBe("skipped");
	});

	test("never writes answer values to the record", async () => {
		const state = memoryState();
		await onboard({
			...base,
			state,
			env: { MYTOOL_API_KEY: "sk-super-secret" },
			nodes: [secret({ id: "apiKey", label: "API key" })],
		});

		const record = await state.read();
		expect(record?.answered).toEqual(["apiKey"]);
		expect(JSON.stringify(record)).not.toContain("sk-super-secret");
	});

	test("a version bump asks only the questions added since", async () => {
		const state = memoryState();
		const env = { MYTOOL_PROVIDER: "openai", MYTOOL_REGION: "us-east" };

		await onboard({
			...base,
			state,
			env,
			version: 1,
			nodes: [choice({ id: "provider", label: "Provider", options: [{ value: "openai" }] })],
		});

		const upgraded = await onboard({
			...base,
			state,
			env,
			version: 2,
			nodes: [
				choice({ id: "provider", label: "Provider", options: [{ value: "openai" }] }),
				choice({ id: "region", label: "Region", options: [{ value: "us-east" }] }),
			],
		});

		// A partial re-run is a distinct outcome: the caller receives only the
		// delta and must merge it, so it must not be reported as "completed".
		expect(upgraded.status).toBe("updated");
		if (upgraded.status !== "updated") return;
		expect(upgraded.answers).toEqual({ region: "us-east" });
		expect(upgraded.added).toEqual(["region"]);

		const record = await state.read();
		expect([...(record?.answered ?? [])].sort()).toEqual(["provider", "region"]);
		expect(record?.version).toBe(2);
	});

	test("state: false disables the record entirely", async () => {
		const nodes = [choice({ id: "provider", label: "Provider", options: [{ value: "openai" }] })];
		const env = { MYTOOL_PROVIDER: "openai" };

		const first = await onboard({ ...base, state: false, env, nodes });
		const second = await onboard({ ...base, state: false, env, nodes });

		expect(first.status).toBe("completed");
		expect(second.status).toBe("completed");
	});
});

describe("non-interactive output", () => {
	test("display nodes stay silent, work nodes still report", async () => {
		const out = sink();
		await onboard({
			name: "MyTool",
			interactive: "never",
			output: out,
			state: false,
			env: { MYTOOL_PROVIDER: "openai" },
			nodes: [
				welcome({ subtitle: "Let's go" }),
				choice({ id: "provider", label: "Provider", options: [{ value: "openai" }] }),
				summary(),
				task({ label: "Writing config", run: () => {} }),
				done({ next: [{ cmd: "mytool start" }] }),
			],
		});

		expect(out.text).not.toContain("Let's go");
		expect(out.text).toContain("Writing config: done");
		expect(out.text).toContain("Provider: openai");
	});
});
