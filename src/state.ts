import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
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
