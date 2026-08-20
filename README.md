# onboard-kit

Drop-in onboarding flows for CLI tools. You pick the nodes and their order — the look is handled.

```bash
npx onboard-kit demo
```

```ts
import { onboard } from "onboard-kit";

await onboard({
  name: "MyTool",
  nodes: [
    { node: "welcome", subtitle: "Let's get you set up." },
    { node: "check", label: "Node 20+", run: () => Number(process.versions.node.split(".")[0]) >= 20 },
    { node: "choice", id: "provider", label: "Which provider?", options: [
        { value: "openai", label: "OpenAI", hint: "gpt-4o" },
        { value: "local",  label: "Local",  hint: "via Ollama" },
    ]},
    { node: "secret", id: "apiKey", label: "API key", when: (a) => a.provider !== "local" },
    { node: "summary" },
    { node: "task", label: "Writing config", run: (a) => writeConfig(a) },
    { node: "done", next: [{ cmd: "mytool start", desc: "launch the daemon" }] },
  ],
});
```

```
┌  MyTool ──────────────────────────────
│
│  Let's get you set up.
│
◇  Checking your environment
│  ✔  Node 20+
│
◇  [1/2]  Which provider?
│  OpenAI
│
◇  [2/2]  API key
│  ••••••••••••••••
│
├  Review ──────────────────────────────
│
│  Which provider?   OpenAI
│  API key           •••••  (hidden)
│
◇  Writing config
│
└  You're all set.

    Next
      mytool start   launch the daemon
```

## It's a template, not a framework

There is no theme object, no colour config, no custom renderers, and no way to author your own node type. That is the point. Spacing, symbols, rails, step counters and the review layout are decided once, here, so your onboarding looks good without you making a single visual decision.

What you control is which nodes run and in what order. That's the whole API.

The one exception is identity — `name`, `logo`, and an optional `accent`.

Colour policy: **hue is spent only on things that need attention.** A warning is yellow, a failure is red; a passing check and a completed step use your terminal's ordinary foreground, because "it worked" is the expected case and shouldn't compete for the eye. Hierarchy comes from weight instead — bold, grey, dim.

Every colour is an ANSI slot, never fixed RGB, so output is drawn from *the reader's own terminal palette* and can't clash with their background. By default the chrome is fully monochrome; set `accent` (one of six named slots) and exactly two things take colour — the title and the `Next` commands.

## Install

```bash
npm install onboard-kit @clack/prompts
```

```bash
bun add onboard-kit @clack/prompts
```

`@clack/prompts` is a peer dependency, so there's exactly one copy in your tree and you control the version. Needs Node 20+ or Bun.

## The node catalog

Twelve nodes, all plain objects discriminated on `node`. That's all of them.

**Display** — render only, no answer

| | |
|---|---|
| `{ node: "welcome", title?, subtitle? }` | Opening banner — omit the node entirely to start with no banner |
| `{ node: "note", title?, body }` | Boxed callout |
| `{ node: "done", message?, next? }` | Closing frame with a command list |

**Question** — produce an answer under `id`

| | |
|---|---|
| `{ node: "choice", id, label, options, default? }` | Pick one (auto-upgrades to autocomplete past 10 options) |
| `{ node: "multiChoice", id, label, options, default?, required? }` | Pick any number |
| `{ node: "confirm", id, label, default? }` | Yes / no |
| `{ node: "text", id, label, placeholder?, default?, validate? }` | Free text |
| `{ node: "secret", id, label, validate? }` | Masked; never persisted, always masked in review |
| `{ node: "pick", id, label, select, root? }` | File or directory path |

**Work** — side effects, with the template's spinner

| | |
|---|---|
| `{ node: "check", label, run, fix?, optional? }` | Environment gate. Fails → prints `fix` and halts. `optional` warns and continues |
| `{ node: "task", label, run }` | Does the work. Receives all answers |
| `{ node: "summary", title?, confirm? }` | The review table — derives itself from the questions above it |

Every node also accepts `when(answers)`, the only control flow there is. No loops, no branching, no sub-flows.

## Typed answers

**By default the answers type is inferred from your node list** — no annotations, no duplicate interface:

```ts
const result = await onboard({ name: "MyTool", nodes: [
  { node: "choice", id: "provider", label: "P", options: [{ value: "openai" }, { value: "anthropic" }] },
  { node: "secret", id: "apiKey", label: "K", when: (a) => a.provider !== "local" },
]});

if (result.status === "completed") {
  result.answers.provider;  // "openai" | "anthropic"
  result.answers.apiKey;    // string | undefined — optional, because it's guarded by `when`
}
```

A `when`-guarded node produces an *optional* key, because it genuinely may never be asked.

**Pass an explicit type and the callbacks get typed too:**

```ts
type Answers = { provider: "openai" | "anthropic"; apiKey: string };

await onboard<Answers>({
  name: "MyTool",
  nodes: [
    { node: "choice", id: "provider", label: "P", options: [{ value: "openai" }] },
    { node: "task", label: "Write", run: (a) => writeConfig(a.provider, a.apiKey) },
    //                                     ^ fully typed
  ],
});
```

This is why nodes are object literals rather than constructor functions. A constructor call resolves its own generics before `onboard()` ever sees the array, so its callbacks can never be typed against sibling nodes. Contextual typing *does* reach into object literals.

## It works without a TTY

The same flow definition drives both the interactive wizard and CI. Each question resolves in order:

```
env var  →  default  →  prompt (interactive only)
```

In CI or a pipe, questions read from `<NAME>_<ID>` — `MYTOOL_API_KEY` for `{ node: "secret", id: "apiKey" }` under `name: "MyTool"`. Anything unresolved returns `needs-input` naming the exact variable. It never hangs waiting for input nobody can give:

```
Cannot continue without input.
No interactive terminal, and these have no value or default:

  API key
    set MYTOOL_API_KEY
```

Force the mode with `interactive: "always" | "never" | "auto"` (default `auto`: interactive iff stdout is a TTY and not CI).

## It only runs once

Pass an `id` and `version` and onboard-kit records completion, then returns `skipped` immediately on later runs — no output, no delay.

```ts
await onboard({ name: "MyTool", id: "mytool-setup", version: 2, nodes: [...] });
```

Bump `version` after adding nodes and returning users are asked **only the new questions**, getting `status: "updated"` with just that delta to merge into their config.

**Answers are never written to disk** — only node ids and the version number. That's what makes it safe to record a flow containing an API key. Storage lives at `$XDG_STATE_HOME/<id>/onboarding.json`; override with `state: fileState(path)`, `memoryState()`, or disable with `state: false`.

## Result

```ts
type OnboardResult<A> =
  | { status: "completed";   answers: A }
  | { status: "updated";     answers: Partial<A>; added: string[] }
  | { status: "skipped";     answers: A }
  | { status: "cancelled";   partial: Partial<A>; atNode: string }
  | { status: "blocked";     failed: string[] }
  | { status: "needs-input"; missing: MissingInput[] }
  | { status: "failed";      error: unknown; atNode: string };
```

Don't want to switch on seven cases? Set `throwOnFailure: true` and the four failure outcomes throw `OnboardError` (carrying the original `result`) instead:

```ts
try {
  const { answers } = await onboard({ name: "MyTool", throwOnFailure: true, nodes: [...] });
} catch (error) {
  if (error instanceof OnboardError) console.error(error.message);
  process.exit(1);
}
```

There's also `isFailure(result)` if you'd rather narrow than throw.

## Three ways to open

How a flow starts is the one visual choice the template leaves you, because it is really a choice about how loud your tool wants to be. There are three, and they are one config key apart.

**A header rule** — the default. Your name in bold, a grey rule out to column 40, and the same rule reappears at every `divider` so the whole flow reads as one frame.

```
┌  MyTool ──────────────────────────────
│
◇  Checking your environment
```

**A wordmark** — `logo: true` draws your name in the template's block font. It replaces the header rule rather than sitting above it: the wordmark *is* the title, and printing both just says the name twice. The letters lead the rail, rising a line and a half above the corner, so the frame joins them partway down instead of capping them.

```
               ▄            ▄
   ▄▄▄▄▄ ▄  ▄ ▄█▄ ▄▄▄▄ ▄▄▄▄ █
┌  █░█░█ █░░█  █░ █░░█ █░░█ █░░
│  █▒█▒█ █▄▄█  █▄ █▄▄█ █▄▄█ █▄▄
│           █
│        ▀▀▀▀
│
◇  Checking your environment
```

**Nothing at all** — omit the `welcome` node and the flow starts on its first real step. No corner, no rule, and no leading rail: there is no frame above it for a rail to continue, so the first block starts flush.

```
◇  Checking your environment
│  ✔  Node 20 or newer
```

`npx onboard-kit demo` ships with all three; two commented lines in `bin/onboard-kit.mjs` switch between them.

### Wordmark details

Letters are drawn in half-blocks, two pixel rows per character cell, which is what lets the block rise by half a line and take its shadow fill on the same cell as its ink. Ink is bold and takes your `accent`; the shadow is always grey, so the brand never competes with the status marks.

A name too wide for the terminal draws nothing rather than wrapping — a wrapped logo looks broken — and the flow falls back to the header rule. Unsupported characters degrade to blanks rather than throwing, since a logo is decoration and must never be able to fail a setup flow.

### A subtitle

Off unless you ask for it. Set `subtitle` on the `welcome` node and it appears one rail below the banner. Your line breaks are kept, and the text is written through untouched, so styling survives — `bold`, `italic`, `dim`, `gray`, `green`, `yellow` and `red` are exported for it.

```ts
import { bold, green } from "onboard-kit";

{ node: "welcome", subtitle: `${bold("Ship faster.")}\n\nRun ${green("mytool start")} when you're done.` }
```

### Your own art

Pass a **string** instead of `true` to supply art of your own, which is also how you use another font entirely:

```ts
import figlet from "figlet";

await onboard({ name: "MyTool", logo: figlet.textSync("MyTool", "Block"), nodes: [...] });
```

onboard-kit doesn't depend on figlet — it just takes the string. Unsupported characters in the built-in font degrade to blanks rather than throwing, since a logo is decoration and must never fail a setup flow.

## Going back

Picked the wrong provider and only realised while typing the API key? **Escape steps back.** The keys are named in a footer inside every prompt's frame — the same one clack draws under its lists, extended and given to the prompts it leaves bare, so the line never comes and goes as the question type changes:

```
◇  [1/3]  Which provider?
│  OpenAI
│
◆  [2/3]  API key
│  sk-abc
│  ↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit
└
```

It is the same line on every prompt — a list, a text field, a yes/no — whether or not each key does something there. A footer is chrome, not a status line: you read it once and then stop seeing it, and an entry that comes and goes with the kind of question reads as the *keys* coming and going. `multiChoice` is the one that differs, and only because it adds `Space: select` rather than dropping anything. The footer leaves with its prompt rather than piling up in the scrollback.

The `summary` is the one prompt without one. By the time you reach `Apply these changes?` the keys have been named under every question you answered, and this is the one place the flow asks for a decision rather than an answer — a key list under it would compete with the table it is about. The keys all still work.

Going back *un-draws*. The question you left and everything after it is erased from the terminal and asked again, so the flow never accumulates a transcript of the answers you changed your mind about — what's on screen is always what you actually answered, step numbering included. Answers you already gave come back as the starting value, so returning to a field means editing it, not retyping it.

Three things bound it, all for the same reason — a step back must never claim to undo something it can't:

- **A `task` is a commit point.** Once it has run it has changed something outside the flow, so the questions behind it stop being reachable.
- **The review steps back too.** Escape at `Apply these changes?` returns to the last question rather than cancelling — that's where a wrong answer is usually spotted.
- **Secrets are retyped.** They are never redisplayed, so there is nothing to offer back.

Escape on the very first question re-asks it rather than quitting: a back key that drops you out of the flow the moment there's nothing behind you is a trap.

Turn it off with `back: false` and Escape goes back to cancelling.

**Tab and Shift+Tab** step through the options too — on a list and on a yes/no — alongside the arrows and their vim equivalents (`j`/`k`). Tab is what a lot of people reach for first, and having it do nothing is a small, avoidable disappointment.

The one prompt that keeps clack's own footer untouched is `pick`, which already ships one of its own (`↑/↓ to select • Enter: confirm • Type: to search`) that isn't ours to extend.

## Resume after a cancel

Set `resumable: true` and a run that gets cancelled or crashes saves its progress, printing how to pick it up:

```
└  Cancelled.

   Resume   mytool setup --resume
   Note     your credentials will be asked again
```

Run it again with `resume: true` and the questions you already answered are **replayed as answered** rather than silently skipped, so a resumed flow reads exactly like an uninterrupted one:

```
◇  Which provider?
│  OpenAI            ← restored, not re-asked
│
◆  [1/2]  API key
```

```ts
await onboard({
  name: "MyTool",
  resumable: true,
  resume: process.argv.includes("--resume"),
  resumeCommand: "mytool setup --resume",
  nodes: [...],
});
```

**Secrets are never saved**, so a resumed flow asks for them again — that's the one thing you retype. Everything else comes back.

Progress lives in `$XDG_RUNTIME_DIR` — on Linux a RAM-backed tmpfs at mode `0700` — falling back to the OS temp dir. It never touches the durable state directory.

It is tagged with the terminal that made it, by device *and inode*, so it dies with that terminal: closing the window makes it unusable immediately, and it is physically deleted by the next onboard-kit run, which sweeps entries whose terminal has gone. (Nothing can run at the instant a terminal closes — the process that would do the deleting exited long before — so the next run is the earliest opportunity that exists.) It is also deleted the moment a flow completes, ignored across flow versions, and expired after 24 hours.

A failed `check` saves nothing: that means the machine isn't ready, and checks re-run anyway.

## Need something the catalog doesn't have?

Use clack directly. onboard-kit is a layer over it, not a wall around it — the rail is the same, so it looks seamless:

```ts
import * as clack from "@clack/prompts";

await onboard({ name: "MyTool", nodes: [ /* ... */ ] });
const when = await clack.date({ message: "Schedule first sync" });
```

If you find yourself reaching for the same custom node in three projects, open an issue — that's the signal it belongs in the catalog.

## Development

```bash
bun install
bun run check     # typechecks src and tests
bun test
bun run build
bun run demo
```

## License

MIT
