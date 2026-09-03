import { z } from "zod";
import type { NodeDefinition } from "@/nodes/types";
import { freeText } from "../../shared/config-fields";

/**
 * Hard ceiling on a single wait (AF-M10-08).
 *
 * Enforced at SAVE time, not mid-run: a workflow that fails three days into a
 * six-day wait has already burned three days, and the author is not watching.
 * Thirty days is well past #27's "fifteen minutes before the meeting" and past
 * any approval that is still meaningful.
 *
 * Exported so `validate.ts` and the config panel state the same number.
 */
export const MAX_WAIT_SECONDS = 30 * 24 * 60 * 60;

export const configSchema = z.object({
  /**
   * `duration` waits a fixed span from now. `until` waits for a timestamp the
   * graph computed — #27 uses it for "the meeting starts at T, wake at T-15m".
   */
  mode: z.enum(["duration", "until"]).optional(),
  /** Seconds to wait in `duration` mode. */
  seconds: z.number().int().min(1).max(MAX_WAIT_SECONDS).optional(),
  /**
   * Template resolving to an ISO 8601 timestamp in `until` mode. A time
   * already past resolves immediately — waking late is the honest outcome, and
   * failing the run because the clock moved on would be worse.
   */
  until: freeText(1024).optional(),
});

export const definition: NodeDefinition = {
  type: "WAIT",
  version: 1,
  category: "LOGIC",
  label: "Wait",
  description:
    "Pause the run for a fixed duration, or until a timestamp the workflow computed.",
  icon: "Clock",
  keywords: ["wait", "delay", "sleep", "pause", "schedule", "until"],
  configSchema,
  defaults: { mode: "duration", seconds: 60 },
  inputs: [{ id: "main", label: "In" }],
  outputs: [{ id: "main", label: "Out" }],
  docsUrl: "/docs/nodes/WAIT",
};
