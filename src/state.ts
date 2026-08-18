import { readlinkSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The "have they already onboarded?" record.
 *
 * Deliberately records *only* which question nodes were answered and at what
 * flow version — never the answers themselves. That is what makes it safe to
 * write an onboarding record for a flow containing an API key, and it is
 * enforced here rather than left to consumer discipline.
 */

export interface OnboardingRecord {
	readonly schema: 1;
	readonly flowId: string;
	readonly version: number;
	readonly completedAt: string;
	/** Ids of question nodes that were answered. Never their values. */
	readonly answered: readonly string[];
}

export interface StateStore {
	read(): Promise<OnboardingRecord | undefined>;
	write(record: OnboardingRecord): Promise<void>;
	clear(): Promise<void>;
}

/** XDG state dir, with Windows and macOS fallbacks. */
export function defaultStatePath(flowId: string): string {
	const { XDG_STATE_HOME, LOCALAPPDATA } = process.env;
	const base =
		XDG_STATE_HOME ??
		(process.platform === "win32" && LOCALAPPDATA ? LOCALAPPDATA : join(homedir(), ".local", "state"));
	return join(base, flowId, "onboarding.json");
}

export function fileState(path: string): StateStore {
	return {
		async read() {
			try {
				const raw = await readFile(path, "utf8");
				const parsed: unknown = JSON.parse(raw);
				if (!isRecord(parsed)) return undefined;
				return parsed;
			} catch {
				// Missing, unreadable, or corrupt state is not an error: it just
				// means "not onboarded". Never block a CLI's first run on this.
				return undefined;
			}
		},
		async write(record) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
		},
		async clear() {
			await rm(path, { force: true });
		},
	};
}

export function memoryState(initial?: OnboardingRecord): StateStore {
	let current = initial;
	return {
		async read() {
			return current;
		},
		async write(record) {
			current = record;
		},
		async clear() {
			current = undefined;
		},
	};
}

/** A store that never reads or writes — for `state: false`. */
export function noState(): StateStore {
	return {
		async read() {
			return undefined;
		},
		async write() {},
		async clear() {},
	};
}

function isRecord(value: unknown): value is OnboardingRecord {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Partial<OnboardingRecord>;
	return (
		v.schema === 1 &&
		typeof v.flowId === "string" &&
		typeof v.version === "number" &&
		typeof v.completedAt === "string" &&
		Array.isArray(v.answered)
	);
}

// ------------------------------------------------------------------ resume

/**
 * A cancelled flow's partial progress.
 *
 * Deliberately separate from {@link OnboardingRecord}: that one is durable and
 * holds no answers, this one holds answers and must not be durable. It lives
 * in the runtime directory, which on Linux is a RAM-backed tmpfs cleared when
 * the user logs out, and it is deleted the moment the flow completes.
 *
 * Secret answers are never included — see `run.ts`, which filters them out
 * before this is written. A resumed flow re-asks them.
 */
export interface ResumeState {
	readonly schema: 1;
	readonly flowId: string;
	readonly version: number;
	readonly savedAt: string;
	/**
	 * The controlling terminal that owned the cancelled run, so a different
	 * terminal ignores it.
	 *
	 * Deliberately the tty and not the parent pid: `bun run` / `npm run` / `npx`
	 * each insert a wrapper process that exits immediately, so a pid would be
	 * dead by the next invocation and every resume would look stale. The tty is
	 * inherited straight through those wrappers.
	 *
	 * Undefined when there is no tty (a pipe, or a platform without `/proc`),
	 * in which case freshness rests on the TTL alone.
	 */
	readonly ownerTty?: string;
	/** Non-secret answers only. */
	readonly answers: Record<string, unknown>;
}

/** How long a saved resume survives even if its shell is still alive. */
export const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Prefers `$XDG_RUNTIME_DIR` (tmpfs, mode 0700, cleared on logout) and falls
 * back to the OS temp dir, which is at least cleared on reboot. Never the
 * durable state directory — partial answers should not outlive the session.
 */
export function defaultResumePath(flowId: string): string {
	const base = process.env.XDG_RUNTIME_DIR ?? tmpdir();
	return join(base, "onboard-kit", `${flowId}.resume.json`);
}

export interface ResumeStore {
	read(): Promise<ResumeState | undefined>;
	write(state: ResumeState): Promise<void>;
	clear(): Promise<void>;
}

export function fileResume(path: string): ResumeStore {
	return {
		async read() {
			try {
				const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
				return isResume(parsed) && isFresh(parsed) ? parsed : undefined;
			} catch {
				return undefined;
			}
		},
		async write(state) {
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			// 0600: the file holds real answers, even if not secret ones.
			await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		},
		async clear() {
			await rm(path, { force: true });
		},
	};
}

export function memoryResume(initial?: ResumeState): ResumeStore {
	let current = initial;
	return {
		async read() {
			return current;
		},
		async write(state) {
			current = state;
		},
		async clear() {
			current = undefined;
		},
	};
}

/**
 * Identifies the controlling terminal, e.g. `/dev/pts/3`.
 *
 * Linux only; undefined elsewhere or when stdin is not a tty. Callers must
 * treat undefined as "unknown", never as a mismatch.
 */
export function currentTty(): string | undefined {
	try {
		const tty = readlinkSync("/proc/self/fd/0");
		return tty.startsWith("/dev/pts/") || tty.startsWith("/dev/tty") ? tty : undefined;
	} catch {
		return undefined;
	}
}

/** Stale once the TTL has passed, or once a different terminal is asking. */
function isFresh(state: ResumeState, now = Date.now()): boolean {
	if (now - Date.parse(state.savedAt) > RESUME_TTL_MS) return false;
	const here = currentTty();
	// Only a positive mismatch disqualifies it. Two unknowns are not a mismatch.
	if (state.ownerTty !== undefined && here !== undefined && state.ownerTty !== here) return false;
	return true;
}

function isResume(value: unknown): value is ResumeState {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Partial<ResumeState>;
	return (
		v.schema === 1 &&
		typeof v.flowId === "string" &&
		typeof v.version === "number" &&
		typeof v.savedAt === "string" &&
		typeof v.answers === "object" &&
		v.answers !== null
	);
}
