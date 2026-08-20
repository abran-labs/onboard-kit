# onboard-kit — design

**Status:** rev 2 — **implemented** in 0.2.0 (phases 1 and 2 of §8)
**Date:** 2026-08-18
**Still open:** §4 (is 12 the right catalog?), §10 Q3 (keep `accent`?)

> **Changed in rev 2.** Rev 1 proposed a configurable flow *engine* with lifecycle hooks
> (`preflight` / `plan` / `apply` / `rollback`), a swappable renderer, and a theming seam.
> That was still a framework. This rev discards it. onboard-kit is a **template**: the visual
> design is closed, and the only thing a developer authors is which nodes run, in what order.

---

## 1. Thesis

> **onboard-kit is a template, not a framework.**
> The look is decided. You choose the nodes and their order. That's the whole API.

Two consequences, and they're the entire design:

**You cannot restyle it.** No theme object, no color config, no custom renderers, no slots. The spacing, symbols, rails, counters, and summary layout are fixed. This is a *feature* — it's what makes the output good without the developer having taste or spending time. A library that lets you customize the look is a library that lets you make it ugly, and most people will.

**You cannot author a node.** Nodes are a closed, curated catalog (§4). You don't write `prompt: ({ask}) => ask.select(...)` — that's just clack with extra steps, and it's how rev 1 leaked the framework back in. You write `choice({ ... })` and the template renders it the one correct way.

What's left for the developer is a flat, ordered list. That's it:

```ts
nodes: [ welcome(…), check(…), choice(…), secret(…), task(…), done(…) ]
```

Positioning, restated: **clack is the renderer, onboard-kit is the composition layer, and the composition vocabulary is closed.**

---

## 2. The one seam: identity, not theme

Strict reading of "predetermined" means every onboarding built with this looks byte-identical, which makes it unusable for anyone shipping a product with a name. So there is exactly one configuration surface, and it is deliberately tiny:

```ts
onboard({
  name: "MyTool",              // appears in the banner and outro
  accent: "cyan",              // one of 6 preset accents — NOT arbitrary hex
  logo: string | undefined,    // optional ASCII banner, rendered in a fixed frame
  nodes: [ … ],
})
```

Six named accents, not free-form color. The moment it takes `#RRGGBB` it becomes a theming API and contrast on dark/light terminals stops being something the template can guarantee.

**Everything else is closed.** No spacing, symbols, layout, borders, animation, or copy for template-owned chrome. If this seam grows past those four fields in review, the thesis has failed and we should say so out loud rather than let it erode.

---

## 3. What it looks like

The template *is* the product, so here is the target output for the flow in §5. Nothing below is configurable except the name and accent:

```
┌   MyTool  ─────────────────────────────────────

│   Let's get you set up. Takes about a minute.
│
◇   Checking your environment
│   ✔  Node 20 or newer
│   ✔  Config directory writable
│   ▲  git not found — optional, skipping sync setup
│
◆   [1/3]  Which provider?
│   ❯ OpenAI      gpt-4o, gpt-4o-mini
│     Anthropic   claude-opus-4
│     Local       via Ollama
│
◇   [2/3]  Which provider?
│   OpenAI
│
◇   [3/3]  API key
│   ••••••••••••••••••••
│
├   Review ───────────────────────────────────────
│
│   Provider    OpenAI
│   API key     ••••••  (hidden)
│   Config      ~/.config/mytool/config.json
│
◆   Apply these changes?  ❯ Yes  /  No
│
◇   Writing config
│   ✔  done in 0.2s
│
└   You're all set.

    Next
      mytool start          launch the daemon
      mytool --help         see all commands
```

Fixed by the template, never by the consumer: the `│` rail, the `◆ ◇ ✔ ▲ ❯` symbol set, the `[n/m]` counter (which counts *question* nodes only — checks and tasks don't inflate the denominator), the Review table's column alignment and secret masking, and the `Next` block layout.

---

## 4. The node catalog — **needs sign-off**

This list is the product. Adding a node later is easy; removing one after release is a breaking change, so the bias should be toward shipping fewer.

### Display — render only, produce no answer

| Node | Purpose |
|---|---|
| `welcome({ title?, subtitle? })` | Opening banner. Uses `name`/`logo` from the root config. |
| `note({ title?, body })` | Boxed callout for something they need to read. |
| `done({ message?, next? })` | Closing frame. `next: [{cmd, desc}]` renders the Next block. |

### Question — produce an answer under `id`

| Node | Clack primitive |
|---|---|
| `choice({ id, label, options, default?, hint? })` | `select` (auto-upgrades to `autocomplete` past ~10 options) |
| `multiChoice({ id, label, options, default?, min?, max? })` | `multiselect` |
| `confirm({ id, label, default? })` | `confirm` |
| `text({ id, label, placeholder?, default?, validate? })` | `text` |
| `secret({ id, label, validate? })` | `password` — masked, never persisted, auto-masked in Review |
| `pick({ id, label, kind: "file" \| "directory", mustExist? })` | `path` |

### Work — side effects, rendered with the template's spinner

| Node | Behavior |
|---|---|
| `check({ label, run, fix?, optional? })` | Environment gate. Fails → prints `fix` and halts. `optional: true` → warns (the `▲` line) and continues. Consecutive checks auto-group under one header. |
| `task({ label, run })` | Does the work. `run` receives all answers. Spinner → `✔` / `✘`. |
| `summary({ title?, confirm? })` | Auto-renders every answer so far as the Review table. `confirm: true` gates continuing. Requires no arguments — it derives its content from the nodes above it. |

**12 nodes.** `summary()` deriving itself from prior nodes is what replaces rev 1's entire `plan()` concept — the developer never builds a change list, they just place the node.

### Deliberately excluded

`section()` (`summary`/`check` already provide visual rhythm), progress bars, tables, anything ASCII-art beyond `logo`, and any node whose only job is spacing. If someone needs a layout primitive, the answer is no — that's theming through the back door.

---

## 5. Full example

```ts
import {
  onboard, welcome, check, choice, secret, summary, task, done,
} from "onboard-kit";

const result = await onboard({
  name: "MyTool",
  accent: "cyan",
  id: "mytool-setup",     // for the "already onboarded?" record
  version: 2,

  nodes: [
    welcome({ subtitle: "Let's get you set up. Takes about a minute." }),

    check({
      label: "Node 20 or newer",
      run: () => Number(process.versions.node.split(".")[0]) >= 20,
      fix: "Upgrade Node: https://nodejs.org",
    }),
    check({
      label: "git",
      run: () => which("git"),
      optional: true,
    }),

    choice({
      id: "provider",
      label: "Which provider?",
      options: [
        { value: "openai",    label: "OpenAI",    hint: "gpt-4o, gpt-4o-mini" },
        { value: "anthropic", label: "Anthropic", hint: "claude-opus-4" },
        { value: "local",     label: "Local",     hint: "via Ollama" },
      ],
    }),

    secret({
      id: "apiKey",
      label: "API key",
      when: (a) => a.provider !== "local",
      validate: (v) => v.startsWith("sk-") || "Doesn't look like a key",
    }),

    summary({ confirm: true }),

    task({
      label: "Writing config",
      run: async (a) => writeConfig(a),
    }),

    done({
      next: [
        { cmd: "mytool start", desc: "launch the daemon" },
        { cmd: "mytool --help", desc: "see all commands" },
      ],
    }),
  ],
});
```

### Control flow

Linear, with exactly one modifier: **`when(answers) => boolean`, available on every node.** No loops, no branching, no jumps, no sub-flows. "Assemble in order" is the mental model and the implementation should refuse to grow past it.

### Result

```ts
type Result<A> =
  | { status: "completed";  answers: A }
  | { status: "skipped";    answers: A }      // already onboarded at this version
  | { status: "cancelled";  partial: Partial<A>; atNode: string }
  | { status: "blocked";    failed: string[] }  // a required check() failed
  | { status: "needs-input"; missing: string[] } // non-interactive, unresolvable
  | { status: "failed";     error: unknown; atNode: string };
```

### Navigation is part of the template, not the flow

A wizard that only moves forward makes the user pay for a misgiving with the whole run. So Escape steps back a question and Ctrl-C quits, and the key footer says so — a keybinding nobody is told about does not exist.

That footer is clack's, extended rather than replaced. Clack already draws one under its list prompts, already positions it, and already styles it; a second line of our own beside it would be two answers to one question. So the entries are appended to its list: `↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit`. Inside the frame, not above the flow — it describes what the thing you are looking at right now will do, and it leaves when that prompt does.

The review is the one prompt that goes without it: by then the keys have been named under every question, and it asks for a decision rather than an answer, so a key list beneath it would compete with the table it is about. They all still work.

Clack only draws that footer for its list prompts, and a footer that appeared and vanished with the kind of question being asked would read as the keys themselves appearing and vanishing. So the prompts it leaves bare get the same line drawn into their frame: after each of clack's writes the closing row is replaced with the footer and the row it displaced, and it is taken back down before the next write — clack renders against the screen it thinks it left behind and never has to know. The displaced row is captured rather than assumed, because a prompt closes on `└` right up until a validation fails, when the same row becomes `└  too short`. Where the closing row isn't there to displace, nothing is drawn: an unfamiliar frame goes without a footer rather than wrong.

One line, everywhere: the same four entries on a list, a text field and a yes/no, whether or not each key does something on that prompt. A footer is chrome, not a status line — it is read once and then stopped being read, and an entry that comes and goes with the kind of question is read as the *keys* coming and going, which is a worse lie than an entry that is briefly inert. `multiChoice` is the sole exception, and only because it adds a key rather than dropping one. Tab and Shift+Tab walk the options too, beside the arrows and vim keys. Not as an alias in clack's table: it matches on the key's *name*, and Node reports Shift+Tab as `tab` with a shift flag, so an alias would send both directions down the list.

The rule the implementation is built around: **going back un-draws.** Re-printing the earlier question below the wrong answer would turn the rail into a transcript of the user's indecision, and would leave the step counter claiming more questions than the flow has. Instead the terminal is rewound — every row drawn since that question is erased, the answers and counters are restored to what they were, and the run continues as though it had never been asked. What is on screen is always exactly what has been answered.

That requires knowing where the cursor is, which no terminal reports. It is derived instead: the template's chrome and clack's prompt frames are written through one screen that counts rows, wraps and cursor moves as they pass. It also requires knowing *why* a prompt ended — clack reports Escape and Ctrl-C as the same cancel — so the keypress stream is watched alongside it.

Three limits, all the same principle, that a step back must not claim to undo what it cannot: a `task` is a commit point and seals the questions behind it; secrets are retyped, never redisplayed; and Escape on the first question re-asks it rather than quitting, because a back key that drops you out of the flow is a trap.

### Two things the template handles silently

**Already onboarded.** `id` + `version` are recorded in a small JSON file after a completed run. A returning user at the same version gets `status: "skipped"` with no output at all. Bump `version` and only nodes added since re-run. Answers are *never* persisted — only node ids and the version. Secrets can't leak because they were never stored.

**No TTY.** In CI or a pipe, question nodes resolve from `MYTOOL_<ID>` env vars and their `default`, in that order. Anything unresolved returns `needs-input` naming the exact env var — never a hang, never a crash. `check` and `task` still run; display nodes print unstyled. This is the one piece of rev 1 worth keeping wholesale, because writing it twice is exactly the pain that justifies the package.

---

## 6. The escape hatch — **needs a decision**

A closed catalog means the first person who needs a date picker or a slider is stuck, and stuck developers uninstall. Three options:

1. **No hatch.** Purest. They fork or leave. Risk: a bad first impression from a real user with a reasonable ask.
2. **`custom({ id, run })`** — receives the template's in-theme primitives so output still matches, but the developer controls the sequence inside. Pragmatic; slight risk of becoming the node everyone reaches for and hollowing out the catalog.
3. **Drop to clack.** Document that you can `import * as clack from "@clack/prompts"` and interleave calls between `onboard()` invocations. Zero API cost, visually seamless (same rail), and it honestly reflects that we're a layer over clack, not a wall around it.

**Recommend 3, with 2 held in reserve.** It costs nothing to ship, keeps the catalog honest, and if the same custom node shows up in three different projects that's the signal it belongs in the catalog instead.

---

## 7. What rev 1 got wrong

| Rev 1 | Rev 2 |
|---|---|
| `Renderer` interface, swappable | **Gone from the public API.** Internal seam for tests only. Not exported, not documented. |
| `preflight: [...]` lifecycle array | `check()` nodes at the top of the list |
| `plan()` → change list → `apply()` → `onUndo()` | `summary()` (derives itself) + `task()` |
| `prompt: ({ask}) => ask.select(…)` | `choice({...})` — the developer never touches a prompt API |
| Flag parsing + `--help` fragments | Cut. Env var + default only. |
| Back navigation | Cut, as before. |
| Rollback / `undo()` | Cut. A `task()` that needs a backup takes one itself. |
| ~7 exported types, 12-member interface | 12 node constructors + `onboard()` + `Result` |

`@clack/prompts` still moves to a **peer dependency** — one copy in the tree, consumer controls the version, and it makes the "drop to clack" hatch in §6 coherent.

---

## 8. Scope

**v0.2 — the template.** `onboard()`, all 12 nodes, fixed visual language, the 4-field identity seam, `when`, non-TTY resolution, already-onboarded state, `Result`. Clack as peer dep.

**v0.3 — proof.** `npx onboard-kit demo` running the §3 flow end to end. For a package selling "it looks good," a demo you can run in 10 seconds is worth more than the README. Should have existed before v0.1 shipped.

**v0.3 — backwards navigation.** Escape steps back a question, the terminal rewinding rather than reprinting. Not a node and not configuration: it is how the template behaves, the same way spacing is.

**v0.4 — considered additions.** Only nodes that showed up in real usage. No new configuration.

**Permanently out:** theming, custom nodes in the catalog sense, arg parsing, config writing, secret storage, i18n of template chrome.

---

## 9. Repo work

Done: `git init`, LICENSE, the `repository`/`homepage`/`bugs`/`author` fields, tests under the typechecker, and the Bun migration (`bun test`, `tsc --emitDeclarationOnly` for types, `bun.lock`; Bun as toolchain, Node-compatible output, `engines: { node: ">=20" }`).

Left before the first publish:

- **A GitHub repo, pushed** — `package.json` advertises `abran-labs/onboard-kit` for homepage, repo and bugs, and every one of those links 404s until it exists
- **An npm account logged in** — the unscoped name `onboard-kit` is unclaimed, so §10's preference is available
- CI running `check` and `test` on push, which matters more than usual: the navigation tests drive real keypresses through timing windows

Two things to keep true as clack moves: the peer range is `^1.7.0` because `formatInstructionFooter` and the instruction arrays do not exist before 1.6.0 and 1.7 is what we test against; and `src` ships alongside `dist` so the declaration maps resolve, which is what makes the comments in this repo reachable from a consumer's editor.

---

## 10. Open questions

1. **Catalog sign-off (§4).** Is 12 right? My instinct: `pick()` and `multiChoice()` are the two least likely to earn their place in v0.2.
2. **Escape hatch (§6).** Recommend "drop to clack," but it's your call.
3. **Is `accent` even worth it?** Dropping it makes the template purer and the promise absolute. Keeping it makes the package usable by people with brand guidelines. Weak preference for keeping.
4. **Name.** `@abran-labs/onboard-kit` or try for unscoped `onboard-kit`? Unscoped is likely free and much better for discovery of a package like this.
