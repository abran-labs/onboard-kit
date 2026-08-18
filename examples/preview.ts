/**
 * Renders the template's static chrome so it can be eyeballed without a TTY.
 * Prompt rendering itself is clack's and is not reproduced here.
 */
import { createTheme } from "../src/theme.js";

const t = createTheme("cyan");

console.log(t.header("MyTool"));
console.log(t.rail());
console.log(t.rail("Let's get you set up. Takes about a minute."));
console.log(t.rail());
console.log(t.step("Checking your environment"));
console.log(t.status("pass", "Node 20 or newer"));
console.log(t.status("pass", "Config directory writable"));
console.log(t.status("warn", "git — not found, skipping sync setup"));
console.log(t.rail());
console.log(t.step("Which provider?"));
console.log(t.rail("OpenAI"));
console.log(t.rail());
console.log(t.step("API key"));
console.log(t.rail("••••••••••••••••"));
console.log(t.rail());
console.log(t.divider("Review"));
console.log(t.rail());
console.log(
	t.rows([
		["Provider", "OpenAI"],
		["API key", "•••••  (hidden)"],
		["Telemetry", "no"],
	]),
);
console.log(t.rail());
console.log(t.step("Writing config"));
console.log(t.rail());
console.log(t.footer("You're all set."));
console.log();
console.log(
	t.next([
		["mytool start", "launch the daemon"],
		["mytool --help", "see all commands"],
	]),
);
console.log();
