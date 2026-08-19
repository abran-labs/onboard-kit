#!/usr/bin/env node
/**
 * `npx onboard-kit demo` — runs a complete flow so you can see the template
 * before installing it. Deliberately plain JS: it ships as-is, no build step.
 */
import { onboard } from "../dist/index.js";

const args = process.argv.slice(2);
const resume = args.includes("--resume");
const command = args.find((a) => !a.startsWith("-")) ?? "demo";

if (command !== "demo") {
	console.error(
		`onboard-kit: unknown command "${command}"\n\nUsage:\n  npx onboard-kit demo [--resume]\n`,
	);
	process.exit(1);
}

const result = await onboard({
	name: "MyTool",
	id: "onboard-kit-demo",
	// Two banner styles. `logo: true` draws the name as a block wordmark that
	// leads the rail; omit it and the name becomes a bold header rule instead.
	// logo: true,
	state: false, // the demo always runs
	interactive: "always",

	// Escape steps back a question and Ctrl-C quits — both named in the footer
	// under the prompt. Going back erases what came after it, so pick a
	// provider, start typing the key, then hit Escape and watch it un-draw.
	// Tab and Shift+Tab walk the options, next to the arrows and j/k.
	//
	// Cancel partway through and it saves your progress, then tells you how to
	// pick it up. Your answers live in the runtime dir (RAM-backed, cleared on
	// logout) and the API key is never among them.
	resumable: true,
	resume,
	resumeCommand: "bun run demo --resume",

	nodes: [
		// Three banner styles: a `welcome` node with `logo: true` above draws the
		// block wordmark, a `welcome` node without it draws a bold header rule,
		// and no `welcome` node at all — this — starts straight at the first step.
		// { node: "welcome" },

		{
			node: "check",
			label: "Node 20 or newer",
			run: () => Number(process.versions.node.split(".")[0]) >= 20,
			fix: "Upgrade Node: https://nodejs.org",
		},
		{ node: "check", label: "Config directory writable", run: () => true },
		{ node: "check", label: "git", run: () => false, fix: "not found, skipping sync setup", optional: true },

		{
			node: "choice",
			id: "provider",
			label: "Which provider?",
			options: [
				{ value: "openai", label: "OpenAI", hint: "gpt-4o, gpt-4o-mini" },
				{ value: "anthropic", label: "Anthropic", hint: "claude-opus-4" },
				{ value: "local", label: "Local", hint: "via Ollama" },
			],
		},
		{
			node: "secret",
			id: "apiKey",
			label: "API key",
			when: (a) => a.provider !== "local",
			validate: (v) => v.length > 8 || "That looks too short",
		},
		{ node: "confirm", id: "telemetry", label: "Send anonymous usage data?", default: false },

		{ node: "summary" },

		{
			node: "task",
			label: "Writing config",
			run: () => new Promise((resolve) => setTimeout(resolve, 600)),
		},

		{
			node: "done",
			next: [
				{ cmd: "mytool start", desc: "launch the daemon" },
				{ cmd: "mytool --help", desc: "see all commands" },
			],
		},
	],
});

// Cancelling is a choice, not a failure — exiting non-zero made the shell
// print an error over the top of the resume hint.
if (result.status === "blocked" || result.status === "failed") process.exitCode = 1;
