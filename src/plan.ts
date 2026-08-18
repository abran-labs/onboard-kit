export interface PlanChange {
  readonly label: string;
  readonly current: string | number | undefined;
  readonly desired: string | number;
  readonly debugLabel?: string;
}

export interface OnboardPlan {
  readonly changes: readonly PlanChange[];
}

export interface ApplyPlanOptions<TResult> {
  readonly dryRun: boolean;
  readonly changes: readonly PlanChange[];
  readonly apply: () => Promise<TResult>;
}

export interface ApplyPlanResult<TResult> {
  readonly mode: "dry-run" | "apply";
  readonly changed: boolean;
  readonly applied: boolean;
  readonly value?: TResult;
}

export function formatPreviewValue(value: string | number | undefined): string {
  return value === undefined || value === "" ? "unset" : String(value);
}

export function formatPlanChange(change: PlanChange): string {
  return `${change.label}: ${formatPreviewValue(change.current)} -> ${String(change.desired)}`;
}

export function formatPlanDebugChange(change: PlanChange): string {
  return `${change.debugLabel ?? change.label}=${change.current ?? ""} -> ${String(change.desired)}`;
}

export function hasPlanChanges(changes: readonly PlanChange[] | OnboardPlan): boolean {
  return "changes" in changes ? changes.changes.length > 0 : changes.length > 0;
}

export async function runApplyPlan<TResult>(options: ApplyPlanOptions<TResult>): Promise<ApplyPlanResult<TResult>> {
  const changed = hasPlanChanges(options.changes);
  if (!changed) {
    return {
      mode: options.dryRun ? "dry-run" : "apply",
      changed: false,
      applied: false
    };
  }

  if (options.dryRun) {
    return {
      mode: "dry-run",
      changed: true,
      applied: false
    };
  }

  const value = await options.apply();
  return {
    mode: "apply",
    changed: true,
    applied: true,
    value
  };
}
