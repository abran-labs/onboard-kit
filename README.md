# onboard-kit

Drop-in onboarding flows for CLI tools. You pick the nodes and their order — the look is handled.

```ts
import { onboard, welcome, check, choice, secret, summary, task, done } from "onboard-kit";

await onboard({
  name: "MyTool",
  nodes: [
    welcome({ subtitle: "Let's get you set up." }),
    check({ label: "Node 20+", run: () => Number(process.versions.node.split(".")[0]) >= 20 }),
    choice({ id: "provider", label: "Which provider?", options: [
      { value: "openai", label: "OpenAI", hint: "gpt-4o" },
      { value: "local", label: "Local", hint: "via Ollama" },
    ]}),
    secret({ id: "apiKey", label: "API key", when: (a) => a.provider !== "local" }),
    summary(),
    task({ label: "Writing config", run: (a) => writeConfig(a) }),
    done({ next: [{ cmd: "mytool start", desc: "launch the daemon" }] }),
  ],
});
```

```
┌  MyTool ──────────────────────────────────────
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
├  Review ──────────────────────────────────────
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

There is no theme object, no colour config, no custom renderers, and no way to author your own node. That is the point. The spacing, symbols, rails, step counters and review layout are decided once, here, so your onboarding looks good without you making a single visual decision.

What you control is which nodes run and in what order. That's the whole API.

The one exception is identity — `name`, `logo`, and `accent` (six presets, not free-form hex), because otherwise every tool's onboarding would be identical.

## Install

```bash
bun add onboard-kit @clack/prompts
```

`@clack/prompts` is a peer dependency, so there's exactly one copy in your tree and you control the version. Needs Node 20+ or Bun.

## The node catalog

Twelve nodes. That's all of them.

**Display** — render only, no answer

| | |
|---|---|
| `welcome({ title?, subtitle? })` | Opening banner |
| `note({ title?, body })` | Boxed callout |
| `done({ message?, next? })` | Closing frame with a command list |

**Question** — produce an answer under `id`

| | |
|---|---|
| `choice({ id, label, options, default?, hint? })` | Pick one (auto-upgrades to autocomplete past 10 options) |
| `multiChoice({ id, label, options, default?, min?, max? })` | Pick any number |
| `confirm({ id, label, default? })` | Yes / no |
| `text({ id, label, placeholder?, default?, validate? })` | Free text |
| `secret({ id, label, validate? })` | Masked; never persisted, always masked in review |
| `pick({ id, label, select, root? })` | File or directory path |

**Work** — side effects, with the template's spinner

| | |
|---|---|
| `check({ label, run, fix?, optional? })` | Environment gate. Fails → prints `fix` and halts. `optional` warns and continues |
| `task({ label, run })` | Does the work. Receives all answers |
| `summary({ title?, confirm? })` | The review table — derives itself from the questions above it |

Every node also accepts `when(answers)`, the only control flow there is. No loops, no branching, no sub-flows.

## Typed answers, inferred

The answers object is derived from your node list. No annotations, no duplicate interface:

```ts
const result = await onboard({ name: "MyTool", nodes: [
  choice({ id: "provider", label: "P", options: [{ value: "openai" }, { value: "anthropic" }] }),
  secret({ id: "apiKey", label: "K", when: (a) => a.provider !== "local" }),
]});

if (result.status === "completed") {
  result.answers.provider;  // "openai" | "anthropic"
  result.answers.apiKey;    // string | undefined  — optional, because it's guarded by `when`
}
```

A `when`-guarded node produces an *optional* key, because it genuinely may never be asked.

## It works without a TTY

The same flow definition drives both the interactive wizard and CI. Each question resolves in order:

```
env var  →  default  →  prompt (interactive only)
```

In CI or a pipe, questions read from `<NAME>_<ID>` — `MYTOOL_API_KEY` for `secret({ id: "apiKey" })` under `name: "MyTool"`. Anything unresolved returns `needs-input` naming the exact variable. It never hangs waiting for input nobody can give:

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
bun run demo      # the full flow above, interactively
```

## License

MIT
