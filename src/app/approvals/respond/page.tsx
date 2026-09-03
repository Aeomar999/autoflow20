import type { Metadata } from "next";
import { ApprovalConfirm } from "@/features/approvals/components/approval-confirm";
import { previewApprovalToken } from "@/features/approvals/server/respond";

/**
 * The approval confirmation page (AF-M10-09).
 *
 * Reachable without a session — an approver may have no AutoFlow account — and
 * outside `(dashboard)` for that reason.
 *
 * It exists because the link cannot act on its own GET. Mail scanners, link
 * previewers and corporate security gateways all fetch links in email, so an
 * endpoint that resolved on GET would be approved by a scanner before the
 * human read the message. This page shows what is being decided and asks for a
 * click.
 */

export const metadata: Metadata = {
  title: "Approval",
  robots: { index: false, follow: false },
};

export default async function ApprovalRespondPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const preview = token
    ? await previewApprovalToken(token)
    : ({
        ok: false,
        reason: "This approval link is missing its token.",
      } as const);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-4 py-12">
      {preview.ok ? (
        <ApprovalConfirm
          token={token as string}
          decision={preview.decision}
          prompt={preview.prompt}
          workflowName={preview.workflowName}
          alreadyResolved={preview.alreadyResolved}
        />
      ) : (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-semibold">Approval unavailable</h1>
          <p className="mt-3 text-sm text-muted-foreground">{preview.reason}</p>
        </div>
      )}
    </main>
  );
}
