#!/usr/bin/env node
/**
 * `npx onboard-kit demo` — runs a complete flow so you can see the template
 * before installing it. Deliberately plain JS: it ships as-is, no build step.
 */
import { onboard } from "../dist/index.js";

const command = process.argv[2] ?? "demo";

if (command !== "demo") {
	console.error(`onboard-kit: unknown command "${command}"\n\nUsage:\n  npx onboard-kit demo\n`);
	process.exit(1);
}

const result = await onboard({
	name: "MyTool",
	accent: "cyan",
	state: false, // the demo always runs
	interactive: "always",

	nodes: [
		{ node: "welcome", subtitle: "This is the onboard-kit demo. Nothing is written to disk." },

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

if (result.status !== "completed") process.exitCode = 1;
