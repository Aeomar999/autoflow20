import { describe, expect, it } from "vitest";

import {
  approvalDedupeKey,
  buildApprovalNotification,
  buildCredentialExpiryNotification,
  buildExecutionNotification,
  buildSystemNotification,
  credentialDedupeKey,
  daysBetween,
  executionDedupeKey,
  summarizeError,
  systemDedupeKey,
} from "./build";
import { NOTIFICATION_TYPE_LABELS } from "./types";

describe("dedupe keys", () => {
  it("is stable for the same logical event", () => {
    // This is the whole replay guarantee: the same event must produce the same
    // key on every retry, or `skipDuplicates` has nothing to collide with.
    expect(executionDedupeKey("exec_1", "EXECUTION_FAILED")).toBe(
      executionDedupeKey("exec_1", "EXECUTION_FAILED"),
    );
  });

  it("separates success from failure for the same run", () => {
    expect(executionDedupeKey("exec_1", "EXECUTION_FAILED")).not.toBe(
      executionDedupeKey("exec_1", "EXECUTION_SUCCEEDED"),
    );
  });

  it("separates runs", () => {
    expect(executionDedupeKey("exec_1", "EXECUTION_FAILED")).not.toBe(
      executionDedupeKey("exec_2", "EXECUTION_FAILED"),
    );
  });

  it("keys credential warnings on the expiry instant, not the run date", () => {
    // A daily sweep must announce a given expiry exactly once, however many
    // times it runs.
    const expiry = new Date("2026-09-07T12:00:00.000Z");
    expect(credentialDedupeKey("cred_1", expiry)).toBe(
      credentialDedupeKey("cred_1", new Date(expiry)),
    );
  });

  it("treats a refreshed expiry as a new warning", () => {
    expect(
      credentialDedupeKey("cred_1", new Date("2026-09-07T12:00:00.000Z")),
    ).not.toBe(
      credentialDedupeKey("cred_1", new Date("2026-10-07T12:00:00.000Z")),
    );
  });

  it("keys approvals on the request", () => {
    expect(approvalDedupeKey("req_1")).not.toBe(approvalDedupeKey("req_2"));
  });
});

describe("buildExecutionNotification", () => {
  it("names the workflow in the title", () => {
    const draft = buildExecutionNotification({
      executionId: "exec_1",
      workflowId: "wf_1",
      workflowName: "Nightly sync",
      succeeded: false,
      error: "Postgres node: connection refused",
    });

    expect(draft.type).toBe("EXECUTION_FAILED");
    expect(draft.title).toBe("Nightly sync failed");
    expect(draft.message).toBe("Postgres node: connection refused");
    expect(draft.href).toBe("/executions/exec_1");
    expect(draft.workflowId).toBe("wf_1");
    expect(draft.credentialId).toBeNull();
  });

  it("uses the success wording when the run succeeded", () => {
    const draft = buildExecutionNotification({
      executionId: "exec_1",
      workflowId: "wf_1",
      workflowName: "Nightly sync",
      succeeded: true,
    });

    expect(draft.type).toBe("EXECUTION_SUCCEEDED");
    expect(draft.title).toBe("Nightly sync finished");
  });
});

describe("summarizeError", () => {
  it("keeps only the first line", () => {
    expect(summarizeError("boom\n  at foo()\n  at bar()")).toBe("boom");
  });

  it("truncates a very long line", () => {
    const summary = summarizeError("x".repeat(500));
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("never returns an empty body", () => {
    // A notification whose message is blank tells the user nothing.
    for (const input of [undefined, null, "", "   ", "\n\n"]) {
      expect(summarizeError(input).length).toBeGreaterThan(0);
    }
  });
});

describe("buildCredentialExpiryNotification", () => {
  it("counts down in whole days", () => {
    const draft = buildCredentialExpiryNotification({
      credentialId: "cred_1",
      credentialName: "Google Sheets",
      expiresAt: new Date("2026-09-07T12:00:00.000Z"),
      daysRemaining: 3,
    });

    expect(draft.title).toBe("Google Sheets expires in 3 days");
    expect(draft.href).toBe("/credentials/cred_1");
    expect(draft.credentialId).toBe("cred_1");
    expect(draft.workflowId).toBeNull();
  });

  it("uses the singular for one day", () => {
    const draft = buildCredentialExpiryNotification({
      credentialId: "cred_1",
      credentialName: "Google Sheets",
      expiresAt: new Date("2026-09-07T12:00:00.000Z"),
      daysRemaining: 1,
    });
    expect(draft.title).toBe("Google Sheets expires in 1 day");
  });

  it("does not say 'in 0 days'", () => {
    const draft = buildCredentialExpiryNotification({
      credentialId: "cred_1",
      credentialName: "Google Sheets",
      expiresAt: new Date("2026-09-07T12:00:00.000Z"),
      daysRemaining: 0,
    });
    expect(draft.title).toBe("Google Sheets expires in less than a day");
  });

  it("switches to the past tense once it has lapsed", () => {
    const draft = buildCredentialExpiryNotification({
      credentialId: "cred_1",
      credentialName: "Google Sheets",
      expiresAt: new Date("2026-08-20T12:00:00.000Z"),
      daysRemaining: -3,
    });
    expect(draft.title).toBe("Google Sheets has expired");
    expect(draft.message).toContain("will fail");
  });
});

describe("buildApprovalNotification", () => {
  it("points at the waiting execution", () => {
    const draft = buildApprovalNotification({
      approvalRequestId: "req_1",
      workflowId: "wf_1",
      workflowName: "Invoice approval",
      executionId: "exec_1",
      nodeName: "Finance sign-off",
    });

    expect(draft.type).toBe("APPROVAL_REQUESTED");
    expect(draft.title).toBe("Invoice approval is waiting for approval");
    expect(draft.message).toContain("Finance sign-off");
    expect(draft.href).toBe("/executions/exec_1");
  });
});

describe("daysBetween", () => {
  it("floors rather than rounds", () => {
    // 47 hours must read as "1 day", never "2": a warning that overstates the
    // time remaining is the dangerous direction to be wrong in.
    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-02T23:00:00.000Z");
    expect(daysBetween(from, to)).toBe(1);
  });

  it("goes negative once the moment has passed", () => {
    expect(
      daysBetween(
        new Date("2026-09-05T00:00:00.000Z"),
        new Date("2026-09-01T00:00:00.000Z"),
      ),
    ).toBe(-4);
  });
});

describe("buildSystemNotification", () => {
  const base = {
    announcementId: "maint-2026-09-14",
    organizationId: "org_1",
    title: "Scheduled maintenance",
    message: "Runs may be delayed between 02:00 and 03:00 UTC.",
  };

  it("carries the operator's own words through unchanged", () => {
    const draft = buildSystemNotification(base);

    expect(draft.type).toBe("SYSTEM");
    expect(draft.title).toBe(base.title);
    expect(draft.message).toBe(base.message);
  });

  it("links nowhere by default", () => {
    // Most announcements have no destination, and navigating to the dashboard
    // for no reason is worse than not navigating at all.
    expect(buildSystemNotification(base).href).toBeNull();
  });

  it("carries an href when the operator gives one", () => {
    expect(buildSystemNotification({ ...base, href: "/status" }).href).toBe(
      "/status",
    );
  });

  it("has no workflow, execution, or credential to point at", () => {
    const draft = buildSystemNotification(base);

    expect(draft.workflowId).toBeNull();
    expect(draft.executionId).toBeNull();
    expect(draft.credentialId).toBeNull();
  });

  it("keys per workspace, so a broadcast reaches every one of them", () => {
    // `dedupeKey` is unique across the whole table. Keyed on the announcement
    // alone, the first workspace written would claim it and `skipDuplicates`
    // would silently swallow the rest of the fan-out.
    expect(systemDedupeKey("maint-1", "org_1")).not.toBe(
      systemDedupeKey("maint-1", "org_2"),
    );
  });

  it("repeats the same key for the same workspace, so a re-run is a no-op", () => {
    expect(buildSystemNotification(base).dedupeKey).toBe(
      buildSystemNotification(base).dedupeKey,
    );
  });

  it("gives a different announcement a different key", () => {
    expect(systemDedupeKey("maint-1", "org_1")).not.toBe(
      systemDedupeKey("maint-2", "org_1"),
    );
  });
});

describe("notification type labels", () => {
  it("labels every type the builders can produce", () => {
    // A type with no label renders as blank in the list.
    for (const type of [
      "EXECUTION_FAILED",
      "EXECUTION_SUCCEEDED",
      "APPROVAL_REQUESTED",
      "CREDENTIAL_EXPIRING",
      "SYSTEM",
    ] as const) {
      expect(NOTIFICATION_TYPE_LABELS[type]).toBeTruthy();
    }
  });
});
