import { describe, expect, test } from "vitest";
import { cancelCurrentStep, runOnboardFlow } from "./flow.js";
import { createMemoryPromptTransport } from "./prompter.js";

describe("runOnboardFlow", () => {
  test("runs steps in order and keeps shared context", async () => {
    const prompts = createMemoryPromptTransport();
    const order: string[] = [];
    const result = await runOnboardFlow({
      title: "Setup",
      completionMessage: "Done",
      prompts,
      context: { count: 0 },
      steps: [
        {
          id: "one",
          run: async ({ context }) => {
            order.push("one");
            context.count += 1;
          }
        },
        {
          id: "two",
          run: async ({ context }) => {
            order.push("two");
            context.count += 2;
          }
        }
      ]
    });

    expect(result).toEqual({
      status: "completed",
      context: { count: 3 }
    });
    expect(order).toEqual(["one", "two"]);
    expect(prompts.events).toEqual([
      { type: "intro", message: "Setup" },
      { type: "outro", message: "Done" }
    ]);
  });

  test("returns cancel result, records cancel output, and stops later steps", async () => {
    const prompts = createMemoryPromptTransport();
    const order: string[] = [];
    const result = await runOnboardFlow({
      title: "Setup",
      prompts,
      context: { providerId: undefined as string | undefined },
      steps: [
        {
          id: "provider",
          run: async ({ context }) => {
            order.push("provider");
            context.providerId = "openai";
            cancelCurrentStep("provider", "User cancelled");
          }
        },
        {
          id: "model",
          run: async () => {
            order.push("model");
          }
        }
      ]
    });

    expect(result).toEqual({
      status: "cancelled",
      reason: "User cancelled",
      stepId: "provider",
      context: { providerId: "openai" }
    });
    expect(order).toEqual(["provider"]);
    expect(prompts.events).toEqual([
      { type: "intro", message: "Setup" },
      { type: "cancel", message: "User cancelled" }
    ]);
  });
});
