/**
 * A complete onboarding flow. Run it with:
 *
 *   bun run examples/demo.ts
 *
 * Nothing here configures the look — only which nodes run and in what order.
 */
import {
	check,
	choice,
	confirm,
	done,
	onboard,
	secret,
	summary,
	task,
	welcome,
} from "../src/index.js";

const result = await onboard({
	name: "MyTool",
	accent: "cyan",
	state: false, // demo: always run, never record

	nodes: [
		welcome({ subtitle: "Let's get you set up. Takes about a minute." }),

		check({
			label: "Node 20 or newer",
			run: () => Number(process.versions.node.split(".")[0]) >= 20,
			fix: "Upgrade Node: https://nodejs.org",
		}),
		check({
			label: "Config directory writable",
			run: () => true,
		}),
		check({
			label: "git",
			run: () => false,
			fix: "not found, skipping sync setup",
			optional: true,
		}),

		choice({
			id: "provider",
			label: "Which provider?",
			options: [
				{ value: "openai", label: "OpenAI", hint: "gpt-4o, gpt-4o-mini" },
				{ value: "anthropic", label: "Anthropic", hint: "claude-opus-4" },
				{ value: "local", label: "Local", hint: "via Ollama" },
			],
		}),

		secret({
			id: "apiKey",
			label: "API key",
			when: (a) => a.provider !== "local",
			validate: (v) => v.length > 8 || "That looks too short",
		}),

		confirm({ id: "telemetry", label: "Send anonymous usage data?", default: false }),

		summary(),

		task({
			label: "Writing config",
			run: async () => {
				await new Promise((r) => setTimeout(r, 600));
			},
		}),

		done({
			next: [
				{ cmd: "mytool start", desc: "launch the daemon" },
				{ cmd: "mytool --help", desc: "see all commands" },
			],
		}),
	],
});

if (result.status !== "completed") {
	process.exitCode = 1;
}
