# onboard-kit

Small TypeScript helpers for guided CLI onboarding flows.

It is intentionally narrow:

- `@clack/prompts` transport by default
- pluggable prompt transport for tests or custom renderers
- cancel-aware flow runner
- plan / dry-run / apply helpers
- preview text helpers for `current -> desired` transitions

No product-specific AI, VoxType, or storage logic lives here.

## Install

```bash
npm install @abran-labs/onboard-kit
```

## Prompt Transport

```ts
import { createClackPromptTransport } from "@abran-labs/onboard-kit";

const prompts = createClackPromptTransport();
```

For tests:

```ts
import { createMemoryPromptTransport } from "@abran-labs/onboard-kit";

const prompts = createMemoryPromptTransport({
  answers: ["openai", true, "sk-test"]
});
```

## Flow Runner

```ts
import {
  cancelFlow,
  createClackPromptTransport,
  runOnboardFlow
} from "@abran-labs/onboard-kit";

const result = await runOnboardFlow({
  title: "My tool setup",
  prompts: createClackPromptTransport(),
  context: { providerId: undefined as string | undefined },
  steps: [
    {
      id: "provider",
      run: async ({ context, prompts }) => {
        const providerId = await prompts.autocomplete({
          message: "Select provider",
          options: [
            { value: "openai", label: "OpenAI" },
            { value: "anthropic", label: "Anthropic" }
          ]
        });
        if (prompts.isCancel(providerId)) cancelFlow("Cancelled");
        context.providerId = providerId;
      }
    }
  ]
});
```

`runOnboardFlow()` returns either:

- `{ status: "completed", context }`
- `{ status: "cancelled", context, reason, stepId }`

## Plans

```ts
import {
  formatPlanChange,
  hasPlanChanges,
  runApplyPlan
} from "@abran-labs/onboard-kit";

const changes = [
  { label: "Smart paste", current: "old", desired: "new" }
];

if (hasPlanChanges(changes)) {
  console.log(formatPlanChange(changes[0]));
}

await runApplyPlan({
  dryRun: false,
  changes,
  apply: async () => {
    // write files here
  }
});
```

## Development

```bash
npm install
npm run check
npm test
npm run build
npm pack --dry-run
```
