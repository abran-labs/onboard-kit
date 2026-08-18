import * as clack from "@clack/prompts";

export type PromptCancel = symbol;

export interface PromptOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

export interface PromptSelectOptions {
  readonly message: string;
  readonly options: readonly PromptOption[];
}

export interface PromptMultiselectOptions extends PromptSelectOptions {
  readonly initialValues?: readonly string[];
  readonly required?: boolean;
}

export interface PromptAutocompleteOptions extends PromptSelectOptions {
  readonly maxItems?: number;
}

export interface PromptConfirmOptions {
  readonly message: string;
  readonly initialValue?: boolean;
}

export interface PromptPasswordOptions {
  readonly message: string;
  readonly validate?: (value: string) => string | undefined;
}

export interface PromptTextOptions {
  readonly message: string;
  readonly placeholder?: string;
  readonly defaultValue?: string;
  readonly validate?: (value: string) => string | undefined;
}

export interface PromptNoteOptions {
  readonly title?: string;
}

export interface PromptTransport {
  readonly intro: (message: string) => void;
  readonly outro: (message: string) => void;
  readonly note: (message: string, options?: PromptNoteOptions) => void;
  readonly cancel: (message: string) => void;
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly select: (options: PromptSelectOptions) => Promise<string | PromptCancel>;
  readonly multiselect: (options: PromptMultiselectOptions) => Promise<string[] | PromptCancel>;
  readonly autocomplete: (options: PromptAutocompleteOptions) => Promise<string | PromptCancel>;
  readonly confirm: (options: PromptConfirmOptions) => Promise<boolean | PromptCancel>;
  readonly password: (options: PromptPasswordOptions) => Promise<string | PromptCancel>;
  readonly text: (options: PromptTextOptions) => Promise<string | PromptCancel>;
  readonly isCancel: (value: unknown) => value is PromptCancel;
}

export interface MemoryPromptEvent {
  readonly type: "intro" | "outro" | "note" | "cancel" | "info" | "warn";
  readonly message: string;
  readonly title?: string;
}

export interface CreateMemoryPromptTransportOptions {
  readonly answers?: readonly unknown[];
}

export interface MemoryPromptTransport extends PromptTransport {
  readonly events: readonly MemoryPromptEvent[];
}

type ClackSelectOptions = Parameters<typeof clack.select<string>>[0]["options"];
type ClackOption = ClackSelectOptions[number];

function toMutableOptions(options: readonly PromptOption[]): ClackSelectOptions {
  const mapped: ClackOption[] = [];
  for (const option of options) {
    const next: ClackOption = { value: option.value, label: option.label };
    if (option.hint !== undefined) {
      next.hint = option.hint;
    }
    mapped.push(next);
  }
  return mapped;
}

function resolveQueuedChoice(answer: unknown, options: readonly PromptOption[], kind: string): string | PromptCancel {
  if (typeof answer === "symbol") return answer;
  if (typeof answer !== "string") {
    throw new Error(`Invalid queued ${kind} answer: ${String(answer)}`);
  }
  const matched = options.find((option) => option.value === answer);
  if (!matched) {
    throw new Error(`Unknown queued ${kind} answer: ${answer}`);
  }
  return matched.value;
}

export function createClackPromptTransport(): PromptTransport {
  return {
    intro: (message) => {
      clack.intro(message);
    },
    outro: (message) => {
      clack.outro(message);
    },
    note: (message, options) => {
      clack.note(message, options?.title);
    },
    cancel: (message) => {
      clack.cancel(message);
    },
    info: (message) => {
      clack.log.info(message);
    },
    warn: (message) => {
      clack.log.warn(message);
    },
    select: async (options) => clack.select({
      message: options.message,
      options: toMutableOptions(options.options)
    }),
    multiselect: async (options) => clack.multiselect({
      message: options.message,
      options: toMutableOptions(options.options),
      ...(options.initialValues !== undefined ? { initialValues: [...options.initialValues] } : {}),
      ...(options.required !== undefined ? { required: options.required } : {})
    }),
    autocomplete: async (options) => clack.autocomplete({
      message: options.message,
      options: toMutableOptions(options.options),
      ...(options.maxItems !== undefined ? { maxItems: options.maxItems } : {})
    }),
    confirm: async (options) => clack.confirm(options),
    password: async (options) => clack.password({
      message: options.message,
      ...(options.validate
        ? {
            validate: (value: string | undefined) =>
              typeof value === "string" ? options.validate?.(value) : "Value is required"
          }
        : {})
    }),
    text: async (options) => clack.text({
      message: options.message,
      ...(options.placeholder !== undefined ? { placeholder: options.placeholder } : {}),
      ...(options.defaultValue !== undefined ? { defaultValue: options.defaultValue } : {}),
      ...(options.validate
        ? {
            validate: (value: string | undefined) =>
              typeof value === "string" ? options.validate?.(value) : "Value is required"
          }
        : {})
    }),
    isCancel: clack.isCancel
  };
}

export function createMemoryPromptTransport(options: CreateMemoryPromptTransportOptions = {}): MemoryPromptTransport {
  const queue = [...(options.answers ?? [])];
  const events: MemoryPromptEvent[] = [];

  function nextAnswer(): unknown {
    if (queue.length === 0) {
      throw new Error("No queued prompt answer available");
    }
    return queue.shift();
  }

  const transport: MemoryPromptTransport = {
    events,
    intro: (message) => {
      events.push({ type: "intro", message });
    },
    outro: (message) => {
      events.push({ type: "outro", message });
    },
    note: (message, promptOptions) => {
      events.push(promptOptions?.title ? { type: "note", message, title: promptOptions.title } : { type: "note", message });
    },
    cancel: (message) => {
      events.push({ type: "cancel", message });
    },
    info: (message) => {
      events.push({ type: "info", message });
    },
    warn: (message) => {
      events.push({ type: "warn", message });
    },
    select: async (promptOptions) => {
      const answer = nextAnswer();
      return resolveQueuedChoice(answer, promptOptions.options, "select");
    },
    multiselect: async (promptOptions) => {
      const answer = nextAnswer();
      if (typeof answer === "symbol") return answer;
      if (!Array.isArray(answer)) {
        throw new Error(`Invalid queued multiselect answer: ${String(answer)}`);
      }
      return answer.map((item) => resolveQueuedChoice(item, promptOptions.options, "multiselect") as string);
    },
    autocomplete: async (promptOptions) => {
      const answer = nextAnswer();
      return resolveQueuedChoice(answer, promptOptions.options, "autocomplete");
    },
    confirm: async () => {
      const answer = nextAnswer();
      if (typeof answer === "boolean" || typeof answer === "symbol") return answer;
      throw new Error(`Invalid queued confirm answer: ${String(answer)}`);
    },
    password: async (promptOptions) => {
      const answer = nextAnswer();
      if (typeof answer === "symbol") return answer;
      if (typeof answer !== "string") {
        throw new Error(`Invalid queued password answer: ${String(answer)}`);
      }
      const validation = promptOptions.validate?.(answer);
      if (validation) throw new Error(validation);
      return answer;
    },
    text: async () => {
      const answer = nextAnswer();
      if (typeof answer === "symbol") return answer;
      if (typeof answer !== "string") {
        throw new Error(`Invalid queued text answer: ${String(answer)}`);
      }
      return answer;
    },
    isCancel: (value): value is PromptCancel => typeof value === "symbol"
  };

  return transport;
}
