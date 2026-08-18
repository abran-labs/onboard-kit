import type { PromptTransport } from "./prompter.js";

const FLOW_CANCELLED = Symbol("FLOW_CANCELLED");

export interface OnboardFlowControls<TContext> {
  readonly context: TContext;
  readonly prompts: PromptTransport;
}

export interface OnboardFlowStep<TContext> {
  readonly id: string;
  readonly run: (controls: OnboardFlowControls<TContext>) => Promise<void>;
}

export interface RunOnboardFlowOptions<TContext> {
  readonly title?: string;
  readonly completionMessage?: string;
  readonly cancelMessage?: string;
  readonly context: TContext;
  readonly prompts: PromptTransport;
  readonly steps: readonly OnboardFlowStep<TContext>[];
}

export interface OnboardCompletedResult<TContext> {
  readonly status: "completed";
  readonly context: TContext;
}

export interface OnboardCancel<TContext> {
  readonly status: "cancelled";
  readonly context: TContext;
  readonly reason: string;
  readonly stepId?: string;
}

export type OnboardResult<TContext> = OnboardCompletedResult<TContext> | OnboardCancel<TContext>;

class OnboardFlowCancellation extends Error {
  readonly marker = FLOW_CANCELLED;
  readonly stepId?: string;

  constructor(message: string, stepId?: string) {
    super(message);
    this.name = "OnboardFlowCancellation";
    if (stepId !== undefined) {
      this.stepId = stepId;
    }
  }
}

export function cancelFlow(message = "Cancelled"): never {
  throw new OnboardFlowCancellation(message);
}

export function isOnboardCancel<TContext>(result: OnboardResult<TContext>): result is OnboardCancel<TContext> {
  return result.status === "cancelled";
}

export async function runOnboardFlow<TContext>(options: RunOnboardFlowOptions<TContext>): Promise<OnboardResult<TContext>> {
  const { title, completionMessage, cancelMessage = "Cancelled", context, prompts, steps } = options;

  if (title) prompts.intro(title);

  for (const step of steps) {
    try {
      await step.run({ context, prompts });
    } catch (error) {
      if (error instanceof OnboardFlowCancellation && error.marker === FLOW_CANCELLED) {
        const reason = error.message || cancelMessage;
        prompts.cancel(reason);
        return {
          status: "cancelled",
          context,
          reason,
          stepId: error.stepId ?? step.id
        };
      }
      throw error;
    }
  }

  if (completionMessage) prompts.outro(completionMessage);

  return {
    status: "completed",
    context
  };
}

export function cancelCurrentStep(stepId: string, message = "Cancelled"): never {
  throw new OnboardFlowCancellation(message, stepId);
}
