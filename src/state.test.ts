import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sweepClosedResumes } from "./state.js";

/**
 * Saved progress must not outlive the terminal that made it.
 *
 * Nothing can run at the instant a terminal closes, so the delete happens on
 * the next onboard-kit run. Until then the entry is already unusable — these
 * tests cover the physical cleanup.
 */

async function dir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "ok-sweep-"));
}

const base = {
	schema: 1 as const,
	flowId: "mytool",
	version: 1,
	savedAt: new Date().toISOString(),
	answers: { provider: "openai" },
};

describe("sweepClosedResumes", () => {
	test("deletes progress whose terminal no longer exists", async () => {
		const d = await dir();
		await writeFile(
			join(d, "mytool.resume.json"),
			JSON.stringify({ ...base, ownerTty: "/dev/pts/99999", ownerTtyIno: 1 }),
		);

		expect(await sweepClosedResumes(d)).toBe(1);
		expect(await readdir(d)).toEqual([]);
	});

	test("deletes progress whose terminal number was reused by a new terminal", async () => {
		const d = await dir();
		// A real device path, but an inode that cannot be its current one.
		await writeFile(
			join(d, "mytool.resume.json"),
			JSON.stringify({ ...base, ownerTty: "/dev/null", ownerTtyIno: 999_999_999 }),
		);

		expect(await sweepClosedResumes(d)).toBe(1);
		expect(await readdir(d)).toEqual([]);
	});

	test("keeps progress whose terminal is still open", async () => {
		const d = await dir();
		const { statSync } = await import("node:fs");
		await writeFile(
			join(d, "mytool.resume.json"),
			JSON.stringify({ ...base, ownerTty: "/dev/null", ownerTtyIno: statSync("/dev/null").ino }),
		);

		expect(await sweepClosedResumes(d)).toBe(0);
		expect(await readdir(d)).toHaveLength(1);
	});

	test("bins corrupt entries, which can never be resumed anyway", async () => {
		const d = await dir();
		await writeFile(join(d, "mytool.resume.json"), "{ not json");

		expect(await sweepClosedResumes(d)).toBe(1);
		expect(await readdir(d)).toEqual([]);
	});

	test("leaves unrelated files alone and tolerates a missing directory", async () => {
		const d = await dir();
		await writeFile(join(d, "notes.txt"), "keep me");
		expect(await sweepClosedResumes(d)).toBe(0);
		expect(await readdir(d)).toEqual(["notes.txt"]);

		expect(await sweepClosedResumes(join(d, "nope"))).toBe(0);
	});
});
