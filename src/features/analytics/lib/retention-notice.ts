import type { Plan } from "@/lib/quotas";
import { resolveRetention } from "@/lib/retention";

/**
 * Tell the reader when the range they picked is wider than their plan keeps
 * (AF-M8-20).
 *
 * Retention became real in AF-M8-06: run history is deleted at the plan's
 * `deleteAfterDays`, and the recorded inputs and outputs are erased earlier
 * still, at `ioRetentionDays`. The dashboard's range picker goes to 90 days
 * regardless, so a FREE workspace asking for 90 days sees at most 35 - and
 * every chart renders that truthfully, as a period that simply contains fewer
 * runs.
 *
 * That is the problem. A chart that quietly stops at the retention boundary is
 * indistinguishable from a quiet month, so the reader draws a conclusion about
 * their usage from an artefact of their plan. Saying so costs one line.
 */

export interface RetentionNotice {
  /** One sentence, safe to render on its own. */
  message: string;
  /** True when the payloads are also gone within the window. */
  affectsPayloads: boolean;
}

const days = (value: number) => (value === 1 ? "1 day" : `${value} days`);

/**
 * Returns `null` when the range fits inside what the plan keeps - the common
 * case, and the one where a banner would be noise.
 */
export const retentionNotice = (
  periodDays: number,
  plan: Plan | string | null | undefined,
): RetentionNotice | null => {
  const policy = resolveRetention(plan);

  const historyTruncated = periodDays > policy.deleteAfterDays;
  const payloadsTruncated = periodDays > policy.ioRetentionDays;

  if (!historyTruncated && !payloadsTruncated) {
    return null;
  }

  if (historyTruncated) {
    return {
      message:
        `This plan keeps run history for ${days(policy.deleteAfterDays)}, ` +
        `so a ${days(periodDays)} range shows at most ${days(policy.deleteAfterDays)} of runs.`,
      affectsPayloads: payloadsTruncated,
    };
  }

  // History is intact across the range; only the recorded inputs and outputs
  // have aged out. Worth saying on a page people open to debug from.
  return {
    message:
      `Runs older than ${days(policy.ioRetentionDays)} keep their timings and cost, ` +
      `but their recorded inputs and outputs have been erased.`,
    affectsPayloads: true,
  };
};
