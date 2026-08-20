import { PassThrough } from "node:stream";
import { describe, expect, test } from "bun:test";
import { envNameFor, numbered, onboard, OnboardError, type OnboardResult, type Output } from "./run.js";
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
	test("inherited output yields the terminal to the task", async () => {
		const out = sink();
		const result = await onboard({
			name: "MyTool",
			interactive: "always",
			output: out,
			state: false,
			nodes: [{
				node: "task",
				label: "Installing dependencies",
				output: "inherit",
				run: () => out.write("package manager output\n"),
			}],
		});

		expect(result.status).toBe("completed");
		expect(out.text).toContain("Installing dependencies");
		expect(out.text).toContain("package manager output");
		expect(out.text).not.toContain("complete");
	});

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

// ---------------------------------------------------------------- navigation

/**
 * Just enough terminal to assert on what a run leaves on screen.
 *
 * Going back is only correct if the questions after it are *gone*, and a raw
 * capture cannot show that: it holds every frame ever drawn, erased or not.
 * Replaying the writes into a grid is what makes the difference visible.
 */
function render(text: string): string {
	const lines: string[] = [""];
	let row = 0;
	let col = 0;
	const csi = /\x1b\[([?0-9;]*)([A-Za-z])/g;
	let at = 0;
	for (let m = csi.exec(text); ; m = csi.exec(text)) {
		const end = m ? m.index : text.length;
		for (let k = at; k < end; k++) {
			const ch = text[k] as string;
			if (ch === "\n") {
				row += 1;
				col = 0;
				while (lines.length <= row) lines.push("");
			} else if (ch === "\r") {
				col = 0;
			} else {
				const line = (lines[row] ?? "").padEnd(col, " ");
				lines[row] = line.slice(0, col) + ch + line.slice(col + 1);
				col += 1;
			}
		}
		if (!m) break;
		at = m.index + m[0].length;
		const n = m[1] === "" || m[1] === undefined ? 1 : Number.parseInt(m[1], 10) || 0;
		if (m[2] === "A") row = Math.max(0, row - n);
		else if (m[2] === "B") row += n;
		else if (m[2] === "D") col = Math.max(0, col - n);
		else if (m[2] === "G" || m[2] === "H") col = 0;
		else if (m[2] === "J") {
			lines[row] = (lines[row] ?? "").slice(0, col);
			lines.length = row + 1;
		}
	}
	return lines.join("\n");
}

function fakeTty(): NodeJS.ReadStream {
	const stream = new PassThrough();
	return Object.assign(stream, { isTTY: true, setRawMode: () => stream }) as unknown as NodeJS.ReadStream;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends keys one at a time, waiting for the screen to stop changing between
 * them — a fixed delay would race the prompt that is still drawing itself.
 *
 * The window has to outlast clack's 50ms escape-sequence timeout: a lone
 * Escape is only recognised once nothing follows it, so a key sent sooner
 * would be read as the tail of an escape sequence and swallowed.
 */
async function drive(input: NodeJS.ReadStream, out: { text: string }, keys: readonly string[]): Promise<string[]> {
	// The screen as it stood before each key. The key footer only exists while
	// its prompt is on screen, so the finished transcript cannot show it.
	const snaps: string[] = [];
	for (const key of keys) {
		let size = -1;
		for (let quiet = 0; quiet < 3; quiet += 1) {
			if (out.text.length !== size) {
				size = out.text.length;
				quiet = -1;
			}
			await sleep(30);
		}
		snaps.push(render(out.text));
		(input as unknown as PassThrough).write(key);
	}
	return snaps;
}

const ESC = "\x1b";
const ENTER = "\r";
const DOWN = "\x1b[B";
const TAB = "\t";
const SHIFT_TAB = "\x1b[Z";

async function flow(keys: readonly string[], config: Record<string, unknown> = {}) {
	const out = sink();
	const input = fakeTty();
	process.env.NO_COLOR = "1";
	const run = onboard({
		name: "MyTool",
		interactive: "always",
		state: false,
		output: out,
		input,
		nodes: [
			{
				node: "choice",
				id: "provider",
				label: "Provider",
				options: [{ value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Anthropic" }],
			},
			{ node: "text", id: "apiKey", label: "API key" },
			{ node: "confirm", id: "telemetry", label: "Telemetry" },
		],
		...config,
	} as never);
	const snaps = await drive(input, out, keys);
	// Built by spreading, so the node list no longer infers its own answers —
	// the loose bag is what these tests assert against.
	const result = (await run) as OnboardResult<Record<string, unknown>>;
	process.env.NO_COLOR = "";
	return { result, snaps, screen: render(out.text) };
}

describe("stepping back", () => {
	test("Escape returns to the previous question and re-asks it", async () => {
		const { result, screen } = await flow([ENTER, "sk-1", ENTER, ESC, "2", ENTER, ENTER]);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		// The key was offered back for editing rather than thrown away, so the
		// typed `2` appends to what was already there.
		expect(result.answers).toEqual({ provider: "openai", apiKey: "sk-12", telemetry: true });
	});

	test("the question stepped back over is erased, not crossed out below", async () => {
		// Pick OpenAI, step back off the next question, pick Anthropic instead.
		const { result, screen } = await flow([ENTER, ESC, DOWN, ENTER, "k", ENTER, ENTER]);

		expect(result.status === "completed" && result.answers.provider).toBe("anthropic");
		// The abandoned answer is gone from the screen entirely — not struck
		// through, not left above the second attempt.
		expect(screen).not.toContain("OpenAI");
		expect(screen).toContain("Anthropic");
		// And the counter is not spent on the attempt that was taken back.
		expect(screen.match(/\[1\/3\]/g)?.length ?? 0).toBe(1);
		expect(screen.match(/\[2\/3\]/g)?.length ?? 0).toBe(1);
	});

	test("Escape on the first question re-asks it rather than quitting", async () => {
		const { result } = await flow([ESC, DOWN, ENTER, "k", ENTER, ENTER]);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers.provider).toBe("anthropic");
	});

	test("Ctrl-C still cancels, at any depth", async () => {
		const { result } = await flow([ENTER, "sk-1", ENTER, "\x03"]);

		expect(result.status).toBe("cancelled");
		if (result.status !== "cancelled") return;
		expect(result.atNode).toBe("telemetry");
		expect(result.partial).toEqual({ provider: "openai", apiKey: "sk-1" });
	});

	test("`back: false` puts Escape back to cancelling", async () => {
		const { result } = await flow([ENTER, ESC], { back: false });

		expect(result.status).toBe("cancelled");
		if (result.status !== "cancelled") return;
		expect(result.atNode).toBe("apiKey");
	});

	test("the key footer names Escape, under the prompt Escape would undo", async () => {
		const { snaps } = await flow([ENTER, "k", ENTER, ENTER]);

		expect(snaps[0]).toContain("↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit");
	});

	test("every prompt carries it, not just the ones clack gives a footer", async () => {
		const { snaps } = await flow([ENTER, "k", ENTER, ENTER]);

		const line = "↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit";
		// The list, the text field clack draws no footer for at all, and the
		// confirm: one line, unchanged, wherever the flow has got to.
		expect(snaps[0]).toContain(line);
		expect(snaps[1]).toContain(line);
		expect(snaps[3]).toContain(line);
	});

	test("it sits inside the frame, above the closing corner", async () => {
		const { snaps } = await flow([ENTER, "k", ENTER, ENTER]);

		// Last line is the row the cursor rests on, below the frame.
		expect(snaps[1]?.split("\n").slice(-3, -1)).toEqual([
			"│  ↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit",
			"└",
		]);
	});

	test("the footer leaves with its prompt rather than piling up in the scrollback", async () => {
		const { screen } = await flow([ENTER, "k", ENTER, ENTER]);
		expect(screen).not.toContain("Ctrl+C: quit");
	});

	test("a validation message keeps its place — the footer displaces nothing", async () => {
		const out = sink();
		const input = fakeTty();
		process.env.NO_COLOR = "1";
		const run = onboard({
			name: "MyTool",
			interactive: "always",
			state: false,
			output: out,
			input,
			nodes: [
				{ node: "text", id: "one", label: "One", validate: (v: string) => (v.length < 3 ? "too short" : true) },
				{ node: "text", id: "two", label: "Two" },
			],
		} as never);
		const snaps = await drive(input, out, ["a", ENTER, "bc", ENTER, "x", ENTER]);
		await run;
		process.env.NO_COLOR = "";

		// The rejected submit: clack closes that frame with the message rather
		// than a bare corner, and the footer goes above it, not over it.
		expect(snaps[2]?.split("\n").slice(-3, -1)).toEqual([
			"│  ↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit",
			"└  too short",
		]);
	});
});

describe("moving between options", () => {
	test("Tab steps down the list and Shift+Tab steps back up", async () => {
		// Down to Anthropic, down to nothing further, then back up.
		const { result } = await flow([TAB, TAB, SHIFT_TAB, ENTER, "k", ENTER, ENTER]);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers.provider).toBe("anthropic");
	});

	test("Tab reaches a confirm too, which clack moves on any cursor key", async () => {
		const { result } = await flow([ENTER, "k", ENTER, TAB, ENTER]);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers.telemetry).toBe(false);
	});

	test("the arrows and their vim equivalents still work", async () => {
		const byArrow = await flow([DOWN, ENTER, "k", ENTER, ENTER]);
		const byVim = await flow(["j", ENTER, "k", ENTER, ENTER]);

		const picked = (r: OnboardResult<Record<string, unknown>>) => r.status === "completed" && r.answers.provider;
		expect(picked(byArrow.result)).toBe("anthropic");
		expect(picked(byVim.result)).toBe("anthropic");
	});
});

describe("what a step back cannot undo", () => {
	async function flowWith(nodes: unknown[], keys: readonly string[]) {
		const out = sink();
		const input = fakeTty();
		process.env.NO_COLOR = "1";
		const run = onboard({
			name: "MyTool",
			interactive: "always",
			state: false,
			output: out,
			input,
			nodes,
		} as never);
		await drive(input, out, keys);
		const result = (await run) as OnboardResult<Record<string, unknown>>;
		process.env.NO_COLOR = "";
		return { result, screen: render(out.text) };
	}

	const questions = [
		{ node: "text", id: "one", label: "One" },
		{ node: "text", id: "two", label: "Two" },
	];

	test("the review goes without a footer — its keys have been named all flow", async () => {
		const out = sink();
		const input = fakeTty();
		process.env.NO_COLOR = "1";
		const run = onboard({
			name: "MyTool",
			interactive: "always",
			state: false,
			output: out,
			input,
			nodes: [{ node: "text", id: "one", label: "One" }, { node: "summary" }],
		} as never);
		const snaps = await drive(input, out, ["a", ENTER, ENTER]);
		await run;
		process.env.NO_COLOR = "";

		expect(snaps[0]).toContain("↑/↓ to navigate • Enter: confirm");
		expect(snaps[2]).toContain("Apply these changes?");
		expect(snaps[2]).not.toContain("Enter: confirm");
	});

	test("the review's keys still work, footer or no footer", async () => {
		const { result } = await flowWith([{ node: "confirm", id: "one", label: "One" }, { node: "summary" }], [
			ENTER, // One: yes
			TAB, // the review's confirm, toggled to No
			ENTER,
		]);

		// Answering No at the review cancels, which is what proves Tab reached it.
		expect(result.status).toBe("cancelled");
	});

	test("the review steps back into the last question, not past it", async () => {
		const { result } = await flowWith([...questions, { node: "summary" }], [
			"a",
			ENTER,
			"b",
			ENTER,
			ESC, // at the review
			"!",
			ENTER, // "Two" again, offered back as `b`
			ENTER, // apply
		]);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		expect(result.answers).toEqual({ one: "a", two: "b!" });
	});

	test("a task is a commit point — the answers behind it stop being reachable", async () => {
		const ran: string[] = [];
		const { result } = await flowWith(
			[
				questions[0],
				{ node: "task", label: "Writing config", run: () => void ran.push("wrote") },
				questions[1],
			],
			["a", ENTER, ESC, "b", ENTER],
		);

		expect(result.status).toBe("completed");
		if (result.status !== "completed") return;
		// Escape re-asked "Two" rather than winding back over the task, so the
		// work was done exactly once and its answer stands.
		expect(result.answers).toEqual({ one: "a", two: "b" });
		expect(ran).toEqual(["wrote"]);
	});
});
