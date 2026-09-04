import { type NextRequest, NextResponse } from "next/server";
import { respondViaLink } from "@/features/approvals/server/respond";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * Resolve an approval from an emailed link (AF-M10-09).
 *
 * **POST only, deliberately.** Mail scanners, link previewers and corporate
 * security gateways follow links in email; an endpoint that resolved on GET
 * would be approved by a scanner before the human read the message. The GET
 * side is a confirmation page (`/approvals/respond`) whose button posts here.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
      comment?: string;
    };

    if (!body.token) {
      return NextResponse.json(
        { ok: false, reason: "This approval link is malformed." },
        { status: 400 },
      );
    }

    // A session is recorded when there is one, and never required: the whole
    // point of the link is that an approver may have no AutoFlow account.
    const session = await auth.api
      .getSession({ headers: request.headers })
      .catch(() => null);

    const outcome = await respondViaLink({
      token: body.token,
      actorId: session?.user.id,
      comment: body.comment,
      ip:
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { ok: false, reason: outcome.reason },
        { status: outcome.status ?? 400 },
      );
    }

    return NextResponse.json(outcome, { status: 200 });
  } catch (error) {
    logger.error("Approval link response failed", { error });
    return NextResponse.json(
      { ok: false, reason: "Something went wrong." },
      { status: 500 },
    );
  }
}
