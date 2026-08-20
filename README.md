![Onboard Kit banner showing three connected hexagonal nodes beside the product name](https://raw.githubusercontent.com/abran-labs/onboard-kit/master/.github/assets/onboard-kit-banner.svg)

# Onboard Kit

[![npm](https://img.shields.io/npm/v/@abran-labs/onboard-kit)](https://www.npmjs.com/package/@abran-labs/onboard-kit)
![downloads](https://img.shields.io/npm/dm/@abran-labs/onboard-kit)
![license](https://img.shields.io/npm/l/@abran-labs/onboard-kit)

**A simple node base onboarding flow for CLI tools.**

## Install

```sh
bun add @abran-labs/onboard-kit
```

```sh
npm install @abran-labs/onboard-kit
```

## What it looks like

```sh
npx @abran-labs/onboard-kit demo
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

## Nodes

| Type | Nodes |
| --- | --- |
| Display | `welcome`, `note`, `done` |
| Question | `choice`, `multiChoice`, `confirm`, `text`, `secret`, `pick` |
| Work | `check`, `task`, `summary` |
