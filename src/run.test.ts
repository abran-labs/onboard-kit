import { describe, expect, test } from "bun:test";
import { envNameFor, numbered, onboard, OnboardError, type Output } from "./run.js";
import { memoryResume, memoryState } from "./state.js";

/**
 * The engine is exercised in non-interactive mode, which is also the mode CI
 * users hit — the path most likely to break and least likely to be noticed
 * by hand.
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
				{
					node: "choice",
					id: "provider",
					label: "Provider",
					options: [{ value: "openai" }, { value: "anthropic" }],
				},
				{ node: "secret", id: "apiKey", label: "API key" },
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
				{
					node: "choice",
					id: "provider",
					label: "Provider",
					options: [{ value: "openai" }, { value: "anthropic" }],
					default: "openai",
				},
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
			nodes: [{ node: "secret", id: "apiKey", label: "API key" }],
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
				{ node: "confirm", id: "telemetry", label: "Telemetry" },
				{
					node: "multiChoice",
					id: "features",
					label: "Features",
					options: [{ value: "a" }, { value: "b" }, { value: "c" }],
				},
			],
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers.telemetry).toBe(false);
		expect(result.answers.features).toEqual(["a", "b"]);
	});
});

describe("when", () => {
	test("skips nodes whose condition is false", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: { MYTOOL_PROVIDER: "local" },
			nodes: [
				{
					node: "choice",
					id: "provider",
					label: "Provider",
					options: [{ value: "local" }, { value: "openai" }],
				},
				{ node: "secret", id: "apiKey", label: "API key", when: (a) => a.provider !== "local" },
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

describe("check", () => {
	test("a failed required check blocks the flow before any task runs", async () => {
		let taskRan = false;
		const result = await onboard({
			...base,
			state: false,
			env: {},
			nodes: [
				{ node: "check", label: "Node 20+", run: () => true },
				{ node: "check", label: "git", run: () => false, fix: "Install git" },
				{
					node: "task",
					label: "Write config",
					run: () => {
						taskRan = true;
					},
				},
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
			nodes: [{ node: "check", label: "git", run: () => false, optional: true }],
		});

		expect(result.status).toBe("completed");
	});

	test("a check that throws counts as a failure, not a crash", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: {},
			nodes: [
				{
					node: "check",
					label: "probe",
					run: () => {
						throw new Error("boom");
					},
				},
			],
		});

		expect(result.status).toBe("blocked");
	});
});

describe("task", () => {
	test("receives the collected answers", async () => {
		let seen: unknown;
		await onboard({
			...base,
			state: false,
			env: { MYTOOL_PROVIDER: "openai" },
			nodes: [
				{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
				{
					node: "task",
					label: "Write",
					run: (a) => {
						seen = a;
					},
				},
			],
		});

		expect(seen).toEqual({ provider: "openai" });
	});

	test("a throwing task fails the flow and names the node", async () => {
		const result = await onboard({
			...base,
			state: false,
			env: {},
			nodes: [
				{
					node: "task",
					label: "Write config",
					run: () => {
						throw new Error("disk full");
					},
				},
			],
		});

		expect(result.status).toBe("failed");
		if (result.status !== "failed") return;
		expect(result.atNode).toBe("task");
		expect((result.error as Error).message).toBe("disk full");
	});
});

describe("throwOnFailure", () => {
	test("throws OnboardError carrying the result instead of returning it", async () => {
		const attempt = onboard({
			...base,
			state: false,
			throwOnFailure: true,
			env: {},
			nodes: [{ node: "check", label: "git", run: () => false, fix: "Install git" }],
		});

		await expect(attempt).rejects.toThrow(OnboardError);
		await attempt.catch((error: unknown) => {
			expect(error).toBeInstanceOf(OnboardError);
			const failure = (error as OnboardError).result;
			expect(failure.status).toBe("blocked");
			if (failure.status !== "blocked") return;
			expect(failure.failed).toEqual(["git"]);
			expect((error as Error).message).toContain("git");
		});
	});

	test("names the missing env vars in the thrown message", async () => {
		const attempt = onboard({
			...base,
			state: false,
			throwOnFailure: true,
			env: {},
			nodes: [{ node: "secret", id: "apiKey", label: "API key" }],
		});

		await expect(attempt).rejects.toThrow("MYTOOL_API_KEY");
	});

	test("does not throw on success", async () => {
		const result = await onboard({
			...base,
			state: false,
			throwOnFailure: true,
			env: { MYTOOL_PROVIDER: "openai" },
			nodes: [{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] }],
		});

		expect(result.status).toBe("completed");
	});
});

describe("onboarding state", () => {
	test("a completed flow is skipped on the next run", async () => {
		const state = memoryState();
		const nodes = [
			{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
		] as const;
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
			nodes: [{ node: "secret", id: "apiKey", label: "API key" }],
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
			nodes: [{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] }],
		});

		const upgraded = await onboard({
			...base,
			state,
			env,
			version: 2,
			nodes: [
				{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
				{ node: "choice", id: "region", label: "Region", options: [{ value: "us-east" }] },
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
		const nodes = [
			{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
		] as const;
		const env = { MYTOOL_PROVIDER: "openai" };

		const first = await onboard({ ...base, state: false, env, nodes });
		const second = await onboard({ ...base, state: false, env, nodes });

		expect(first.status).toBe("completed");
		expect(second.status).toBe("completed");
	});
});

describe("welcome banner", () => {
	async function banner(node: Record<string, unknown>, logo?: true) {
		const out = sink();
		process.env.NO_COLOR = "1";
		await onboard({
			name: "MyTool",
			interactive: "always",
			output: out,
			state: false,
			...(logo ? { logo } : {}),
			nodes: [node] as never,
		});
		process.env.NO_COLOR = "";
		return out.text.split("\n");
	}

	test("no subtitle by default — the banner is just the name", async () => {
		expect((await banner({ node: "welcome" })).join("\n")).toMatch(/^\n┌ {2}MyTool ─+\n$/);
	});

	test("no welcome node means no banner and no orphan rail", async () => {
		const out = sink();
		process.env.NO_COLOR = "1";
		await onboard({
			name: "MyTool",
			interactive: "always",
			output: out,
			state: false,
			nodes: [{ node: "check", label: "Node 20 or newer", run: () => true }],
		});
		process.env.NO_COLOR = "";

		// Straight into the first block: no `┌`, no rule, and no lone `│` above
		// it — there is no rail yet for that rail to continue.
		expect(out.text.split("\n")[0]).toBe("◇  Checking your environment");
	});

	test("the two banner styles differ in their run-up", async () => {
		// A wordmark leads with rows that overhang the corner, so it starts flush.
		// A one-line header has no such run-up and takes a blank line instead.
		expect((await banner({ node: "welcome" }))[0]).toBe("");
		expect((await banner({ node: "welcome" }, true))[0]).not.toBe("");
	});

	test("a subtitle keeps its own line breaks, one rail of air below the wordmark", async () => {
		const lines = await banner({ node: "welcome", subtitle: "First line\n\nThird line" });
		const first = lines.findIndex((l) => l.includes("First line"));

		expect(first).toBeGreaterThan(0);
		// A bare rail separates the blurb from the letters above it.
		expect(lines[first - 1]).toBe("│");
		// The caller's blank line survives as a bare rail, not "│  ".
		expect(lines[first + 1]).toBe("│");
		expect(lines[first + 2]).toContain("Third line");
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
				{ node: "welcome", subtitle: "Let's go" },
				{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
				{ node: "summary" },
				{ node: "task", label: "Writing config", run: () => {} },
				{ node: "done", next: [{ cmd: "mytool start" }] },
			],
		});

		expect(out.text).not.toContain("Let's go");
		expect(out.text).toContain("Writing config: done");
		expect(out.text).toContain("Provider: openai");
	});

	test("secrets stay masked even in the non-interactive echo", async () => {
		const out = sink();
		await onboard({
			name: "MyTool",
			interactive: "never",
			output: out,
			state: false,
			env: { MYTOOL_API_KEY: "sk-super-secret" },
			nodes: [
				{ node: "secret", id: "apiKey", label: "API key" },
				{ node: "summary" },
			],
		});

		expect(out.text).not.toContain("sk-super-secret");
		expect(out.text).toContain("hidden");
	});
});

describe("review rendering", () => {
	test("shows the option label the user picked, not the stored value", async () => {
		const out = sink();
		await onboard({
			name: "MyTool",
			interactive: "never",
			output: out,
			state: false,
			env: { MYTOOL_PROVIDER: "openai", MYTOOL_FEATURES: "sync,cloud" },
			nodes: [
				{
					node: "choice",
					id: "provider",
					label: "Which provider?",
					options: [
						{ value: "openai", label: "OpenAI" },
						{ value: "anthropic", label: "Anthropic" },
					],
				},
				{
					node: "multiChoice",
					id: "features",
					label: "Features",
					options: [
						{ value: "sync", label: "Sync" },
						{ value: "cloud", label: "Cloud" },
					],
				},
				{ node: "summary" },
			],
		});

		expect(out.text).toContain("Which provider?: OpenAI");
		expect(out.text).toContain("Features: Sync, Cloud");
	});

	test("falls back to the raw value when an option has no label", async () => {
		const out = sink();
		await onboard({
			name: "MyTool",
			interactive: "never",
			output: out,
			state: false,
			env: { MYTOOL_PROVIDER: "openai" },
			nodes: [
				{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
				{ node: "summary" },
			],
		});

		expect(out.text).toContain("Provider: openai");
	});
});

describe("resume", () => {
	const cancelling = [
		{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
		{ node: "secret", id: "apiKey", label: "API key" },
		{ node: "summary" },
	] as const;

	test("saves non-secret answers when a run does not finish, never the secret", async () => {
		const resumeStore = memoryResume();
		const result = await onboard({
			...base,
			state: false,
			resumable: true,
			resumeStore,
			env: { MYTOOL_PROVIDER: "openai", MYTOOL_API_KEY: "sk-super-secret" },
			nodes: [
				...cancelling,
				{
					node: "task",
					label: "Write config",
					run: () => {
						throw new Error("disk full");
					},
				},
			],
		});

		expect(result.status).toBe("failed");
		const saved = await resumeStore.read();
		expect(saved?.answers).toEqual({ provider: "openai" });
		// The whole point: the API key was collected but must not be written.
		expect(JSON.stringify(saved)).not.toContain("sk-super-secret");
		expect(saved?.answers.apiKey).toBeUndefined();
	});

	test("a failed environment check saves nothing — the machine is not ready", async () => {
		const resumeStore = memoryResume();
		const result = await onboard({
			...base,
			state: false,
			resumable: true,
			resumeStore,
			env: { MYTOOL_PROVIDER: "openai" },
			nodes: [
				{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
				{ node: "check", label: "docker", run: () => false, fix: "Install docker" },
			],
		});

		expect(result.status).toBe("blocked");
		expect(await resumeStore.read()).toBeUndefined();
	});

	test("a resumed run skips restored answers and re-asks secrets", async () => {
		const resumeStore = memoryResume({
			schema: 1,
			flowId: "mytool",
			version: 1,
			savedAt: new Date().toISOString(),
			answers: { provider: "openai" },
		});

		const out = sink();
		const result = await onboard({
			name: "MyTool",
			interactive: "never",
			output: out,
			state: false,
			resume: true,
			resumeStore,
			// Only the secret is available in the environment; provider comes
			// from the saved state, proving it was not re-asked.
			env: { MYTOOL_API_KEY: "sk-live" },
			nodes: cancelling,
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers).toEqual({ provider: "openai", apiKey: "sk-live" });
	});

	test("completing clears the saved progress", async () => {
		const resumeStore = memoryResume({
			schema: 1,
			flowId: "mytool",
			version: 1,
			savedAt: new Date().toISOString(),
			answers: { provider: "openai" },
		});

		await onboard({
			...base,
			state: false,
			resume: true,
			resumeStore,
			env: { MYTOOL_API_KEY: "sk-live" },
			nodes: cancelling,
		});

		expect(await resumeStore.read()).toBeUndefined();
	});

	test("saved progress from a different flow version is ignored", async () => {
		const resumeStore = memoryResume({
			schema: 1,
			flowId: "mytool",
			version: 1,
			savedAt: new Date().toISOString(),
			answers: { provider: "openai" },
		});

		const result = await onboard({
			...base,
			state: false,
			version: 2,
			resume: true,
			resumeStore,
			env: { MYTOOL_API_KEY: "sk-live" },
			nodes: cancelling,
		});

		// provider was not restored, so it has no value and no default
		expect(result.status).toBe("needs-input");
		if (result.status !== "needs-input") return;
		expect(result.missing.map((m) => m.id)).toEqual(["provider"]);
	});

	test("without resumable, nothing is written", async () => {
		const resumeStore = memoryResume();
		await onboard({
			...base,
			state: false,
			resumeStore,
			env: {},
			nodes: [{ node: "secret", id: "apiKey", label: "API key" }],
		});

		expect(await resumeStore.read()).toBeUndefined();
	});
});

describe("step numbering", () => {
	test("counts every question, and omits the counter when there is only one", () => {
		expect(numbered(2, 3, "API key")).toContain("[2/3]");
		expect(numbered(2, 3, "API key")).toContain("API key");
		expect(numbered(1, 1, "API key")).toBe("API key");
	});

	test("a resumed run numbers replayed questions as the original did", async () => {
		// The denominator must include restored questions: they were asked, just
		// on the earlier run. Excluding them renumbered the remaining steps, so a
		// resumed flow showed [1/2] where the first run had shown [2/3].
		const nodes = [
			{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
			{ node: "secret", id: "apiKey", label: "API key" },
			{ node: "confirm", id: "telemetry", label: "Telemetry" },
		] as const;

		const resumeStore = memoryResume({
			schema: 1,
			flowId: "mytool",
			version: 1,
			savedAt: new Date().toISOString(),
			answers: { provider: "openai" },
		});

		const result = await onboard({
			...base,
			state: false,
			resume: true,
			resumeStore,
			env: { MYTOOL_API_KEY: "sk-live", MYTOOL_TELEMETRY: "true" },
			nodes,
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		// All three answers present: one restored, two freshly resolved.
		expect(result.answers).toEqual({ provider: "openai", apiKey: "sk-live", telemetry: true });
	});
});

describe("stale progress", () => {
	const saved = () =>
		memoryResume({
			schema: 1,
			flowId: "mytool",
			version: 1,
			savedAt: new Date().toISOString(),
			answers: { provider: "anthropic" },
		});

	test("a fresh run discards earlier progress once it answers something", async () => {
		const resumeStore = saved();
		await onboard({
			...base,
			state: false,
			resumeStore,
			env: { MYTOOL_PROVIDER: "openai" },
			nodes: [
				{ node: "choice", id: "provider", label: "Provider", options: [{ value: "openai" }] },
				// Blocked runs never reach a save, so without the discard the old
				// answers would stay resumable after an abandoned attempt.
				{ node: "check", label: "gate", run: () => false, fix: "n/a" },
			],
		});

		expect(await resumeStore.read()).toBeUndefined();
	});

	test("quitting before answering anything keeps what was already saved", async () => {
		const resumeStore = saved();
		await onboard({
			...base,
			state: false,
			resumeStore,
			env: {},
			// Blocked before any question is reached: the user has not committed
			// to starting over, so their earlier progress must survive.
			nodes: [{ node: "check", label: "gate", run: () => false, fix: "n/a" }],
		});

		expect((await resumeStore.read())?.answers).toEqual({ provider: "anthropic" });
	});

	test("a resuming run keeps its own saved progress", async () => {
		const resumeStore = saved();
		const result = await onboard({
			...base,
			state: false,
			resume: true,
			resumeStore,
			env: {},
			nodes: [{ node: "choice", id: "provider", label: "Provider", options: [{ value: "anthropic" }] }],
		});

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers.provider).toBe("anthropic");
	});
});
