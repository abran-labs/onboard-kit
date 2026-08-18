/**
 * onboard-kit — drop-in onboarding flows for CLI tools.
 *
 * Nodes are plain object literals. You choose which ones run and in what
 * order; the look is not yours to configure, and that is the point.
 *
 * @example
 * ```ts
 * import { onboard } from "onboard-kit";
 *
 * await onboard({
 *   name: "MyTool",
 *   nodes: [
 *     { node: "welcome", subtitle: "Let's get you set up." },
 *     { node: "choice", id: "provider", label: "Provider",
 *       options: [{ value: "openai" }, { value: "local" }] },
 *     { node: "secret", id: "apiKey", label: "API key",
 *       when: (a) => a.provider !== "local" },
 *     { node: "summary" },
 *     { node: "task", label: "Writing config", run: (a) => writeConfig(a) },
 *     { node: "done", next: [{ cmd: "mytool start" }] },
 *   ],
 * });
 * ```
 */

export {
	AUTOCOMPLETE_THRESHOLD,
	envNameFor,
	type InteractiveMode,
	isFailure,
	type MissingInput,
	onboard,
	type OnboardConfig,
	OnboardError,
	type OnboardFailure,
	type OnboardResult,
	type OnboardSuccess,
	type Output,
} from "./run.js";

export {
	defaultResumePath,
	defaultStatePath,
	fileResume,
	fileState,
	memoryResume,
	memoryState,
	noState,
	type OnboardingRecord,
	RESUME_TTL_MS,
	type ResumeState,
	type ResumeStore,
	type StateStore,
} from "./state.js";

export type { Accent } from "./theme.js";

export type {
	AnswerBag,
	AnswersOf,
	CheckNode,
	ChoiceNode,
	ConfirmNode,
	DoneNode,
	MultiChoiceNode,
	NextEntry,
	Node,
	NodeOption,
	NoteNode,
	PickNode,
	QuestionNode,
	SecretNode,
	SummaryNode,
	TaskNode,
	TextNode,
	Validator,
	WelcomeNode,
} from "./types.js";
