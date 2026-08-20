![onboard-kit banner showing an abstract terminal rail with one step in progress beside the product name](.github/assets/onboard-kit-banner.svg)

# onboard-kit

**Drop-in onboarding flows for CLI tools.**

## Install

Pending: use this exact command after npm package onboard-kit@0.3.0 is published.

```sh
bun add onboard-kit @clack/prompts
```

```sh
npm install onboard-kit @clack/prompts
```

Needs Node 20+ or Bun. `@clack/prompts` is a peer dependency.

## What it looks like

```sh
npx onboard-kit demo
```

```
┌  MyTool ──────────────────────────────
│
◇  Checking your environment
│  ✔  Node 20+
│
◇  [1/2]  Which provider?
│  OpenAI
│
◆  [2/2]  API key
│  ••••••••••••
│  ↑/↓ to navigate • Enter: confirm • Esc: back • Ctrl+C: quit
└
```

Escape steps back. The flow rewinds the terminal rather than reprinting, so what is on screen is always what you actually answered.

## Nodes

| Kind | Nodes |
| --- | --- |
| Display | `welcome`, `note`, `done` |
| Question | `choice`, `multiChoice`, `confirm`, `text`, `secret`, `pick` |
| Work | `check`, `task`, `summary` |

Nodes are plain objects. You choose which ones run and in what order — that is the whole API.

## Why onboard-kit

Every CLI needs a first-run flow, and every one of them is rebuilt from scratch — prompts, spacing, step counters, a review screen, a way back, and a path that still works in CI where nobody can answer. onboard-kit decides all of that once, so the only thing left to choose is the questions.

There is no theme object, no colour config and no custom renderers. That is the point.

MIT licensed.
