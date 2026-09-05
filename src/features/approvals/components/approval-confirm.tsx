"use client";

import { useState } from "react";

/**
 * The confirm step behind an approval link (AF-M10-09).
 *
 * The whole component exists so the decision is a deliberate click rather than
 * a side effect of something fetching the URL.
 */
export function ApprovalConfirm({
  token,
  decision,
  prompt,
  workflowName,
  alreadyResolved,
}: {
  token: string;
  decision: "APPROVED" | "REJECTED";
  prompt: string | null;
  workflowName: string;
  alreadyResolved: boolean;
}) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [comment, setComment] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const approving = decision === "APPROVED";
  const verb = approving ? "Approve" : "Reject";

  async function confirm() {
    setState("sending");
    setFailure(null);
    try {
      const response = await fetch("/api/approvals/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, comment: comment || undefined }),
      });
      if (response.ok) {
        setState("done");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        reason?: string;
      };
      // Says what happened. "Already approved" and "expired" need different
      // things from the reader, and one generic message serves neither.
      setFailure(body.reason ?? "Something went wrong.");
      setState("idle");
    } catch {
      setFailure("Could not reach the server. Check your connection.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <output className="block rounded-lg border border-border bg-card p-8 text-center">
        <h1 className="text-lg font-semibold">
          {approving ? "Approved" : "Rejected"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The workflow has been told. You can close this page.
        </p>
      </output>
    );
  }

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-6 sm:p-8">
      <header className="flex flex-col gap-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {workflowName}
        </p>
        <h1 className="text-xl font-semibold">{verb} this request?</h1>
        {prompt ? (
          <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">
            {prompt}
          </p>
        ) : null}
      </header>

      {alreadyResolved ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm"
        >
          This request has already been answered. Confirming again will not
          change it.
        </p>
      ) : null}

      {failure ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {failure}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="approval-comment" className="text-sm font-medium">
          Add a note (optional)
        </label>
        <textarea
          id="approval-comment"
          rows={3}
          maxLength={500}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring/30"
          placeholder="Recorded with your decision."
        />
      </div>

      <button
        type="button"
        onClick={confirm}
        disabled={state === "sending" || alreadyResolved}
        className={`rounded-md px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 ${
          approving ? "bg-primary" : "bg-destructive"
        }`}
      >
        {state === "sending" ? "Sending…" : `Confirm — ${verb.toLowerCase()}`}
      </button>
    </div>
  );
}
