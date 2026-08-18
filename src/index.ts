/**
 * onboard-kit — drop-in onboarding flows for CLI tools.
 *
 * Pick your nodes, choose the order. The look is not yours to configure, and
 * that is the point: every flow built with this package is consistent and
 * good without anyone making a visual decision.
 *
 * @example
 * ```ts
 * import { onboard, welcome, choice, secret, summary, task, done } from "onboard-kit";
 *
 * await onboard({
 *   name: "MyTool",
 *   nodes: [
 *     welcome({ subtitle: "Let's get you set up." }),
 *     choice({ id: "provider", label: "Provider", options: [{ value: "openai" }] }),
 *     secret({ id: "apiKey", label: "API key" }),
 *     summary(),
 *     task({ label: "Writing config", run: (a) => writeConfig(a) }),
 *     done({ next: [{ cmd: "mytool start", desc: "launch the daemon" }] }),
 *   ],
 * });
 * ```
 */

export {
	check,
	choice,
	confirm,
	done,
	multiChoice,
	note,
	pick,
	secret,
	summary,
	task,
	text,
	welcome,
} from "./nodes.js";

export {
	AUTOCOMPLETE_THRESHOLD,
	envNameFor,
	type InteractiveMode,
	type MissingInput,
	onboard,
	type OnboardConfig,
	type OnboardResult,
} from "./run.js";

export {
	defaultStatePath,
	fileState,
	memoryState,
	noState,
	type OnboardingRecord,
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
	WelcomeNode,
	When,
} from "./types.js";
