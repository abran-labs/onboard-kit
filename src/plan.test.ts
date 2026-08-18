import { describe, expect, test, vi } from "vitest";
import { formatPlanChange, formatPlanDebugChange, hasPlanChanges, runApplyPlan } from "./plan.js";

describe("plan helpers", () => {
  test("formats human and debug transitions", () => {
    const change = {
      label: "Will change smart paste",
      debugLabel: "plan.post_output_command",
      current: undefined,
      desired: "voxtype-tools smart-paste"
    };

    expect(formatPlanChange(change)).toBe("Will change smart paste: unset -> voxtype-tools smart-paste");
    expect(formatPlanDebugChange(change)).toBe("plan.post_output_command= -> voxtype-tools smart-paste");
  });

  test("dry-run reports change without applying", async () => {
    const apply = vi.fn(async () => "applied");
    const result = await runApplyPlan({
      dryRun: true,
      changes: [{ label: "Timeout", current: 1000, desired: 30000 }],
      apply
    });

    expect(hasPlanChanges([{ label: "Timeout", current: 1000, desired: 30000 }])).toBe(true);
    expect(result).toEqual({
      mode: "dry-run",
      changed: true,
      applied: false
    });
    expect(apply).not.toHaveBeenCalled();
  });

  test("apply mode runs only when changes exist", async () => {
    const apply = vi.fn(async () => ({ backupPath: "/tmp/config.bak" }));
    const changedResult = await runApplyPlan({
      dryRun: false,
      changes: [{ label: "Timeout", current: 1000, desired: 30000 }],
      apply
    });
    const unchangedResult = await runApplyPlan({
      dryRun: false,
      changes: [],
      apply
    });

    expect(changedResult).toEqual({
      mode: "apply",
      changed: true,
      applied: true,
      value: { backupPath: "/tmp/config.bak" }
    });
    expect(unchangedResult).toEqual({
      mode: "apply",
      changed: false,
      applied: false
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
