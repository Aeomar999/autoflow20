import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { serviceEndpoint } from "@/lib/server/service-endpoints";

/**
 * Jira attachment upload (AF-M10-18).
 *
 * Separate from `jira-client` because it is the one Jira call that is not
 * JSON, and it carries a header nothing else needs.
 *
 * **`X-Atlassian-Token: no-check` is mandatory.** Without it Jira rejects the
 * upload as a suspected XSRF attack, and the response is an HTML error page
 * rather than a JSON error — so a client that assumes JSON reports a parse
 * failure and buries the actual cause. It is the single most common reason a
 * Jira attachment integration does not work.
 */

const UPLOAD_TIMEOUT_MS = 60_000;

export interface JiraAttachment {
  id?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  content?: string;
}

export async function uploadJiraAttachment(args: {
  secret: CredentialSecret | undefined;
  issueKey: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  where: string;
}): Promise<JiraAttachment[]> {
  const accessToken = args.secret?.accessToken;
  const cloudId = args.secret?.cloudId;

  if (!accessToken) {
    throw new NonRetriableError(
      `${args.where}: no Jira credential is bound to this node. Connect an Atlassian credential.`,
    );
  }
  if (!cloudId) {
    throw new NonRetriableError(
      `${args.where}: the Jira credential has no cloud id stored. Reconnect the Atlassian credential so the site can be resolved.`,
    );
  }

  const form = new FormData();
  // The field name must be exactly "file"; Jira ignores anything else and
  // then reports that no file was supplied.
  form.append(
    "file",
    new Blob([new Uint8Array(args.data)], { type: args.mimeType }),
    args.filename,
  );

  const response = await fetch(
    `${serviceEndpoint("atlassian")}/ex/jira/${cloudId}/rest/api/3/issue/${args.issueKey}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        // See the module comment: without this the upload is refused as XSRF.
        "X-Atlassian-Token": "no-check",
        // Content-Type is deliberately absent — fetch sets it with the
        // multipart boundary, and overriding it produces an unparseable body.
      },
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "30");
      throw new RetryAfterError(
        `${args.where}: Jira rate limit hit while uploading.`,
        Number.isFinite(retryAfter) ? retryAfter : 30,
      );
    }
    if (response.status >= 500) {
      throw new RetryAfterError(
        `${args.where}: Jira is unavailable (${response.status}).`,
        15,
      );
    }
    if (response.status === 413) {
      throw new NonRetriableError(
        `${args.where}: the file is larger than this Jira site's attachment limit.`,
      );
    }
    if (response.status === 404) {
      throw new NonRetriableError(
        `${args.where}: issue ${args.issueKey} was not found, or the account cannot attach files to it.`,
      );
    }

    const text = await response.text().catch(() => "");
    throw new NonRetriableError(
      `${args.where}: Jira refused the attachment (${response.status})${
        // The body is often HTML when the XSRF header is the problem, so a
        // short excerpt is more useful than pretending it was JSON.
        text ? `: ${text.slice(0, 200)}` : ""
      }.`,
    );
  }

  const parsed = (await response.json()) as JiraAttachment[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new NonRetriableError(
      `${args.where}: Jira accepted the upload but returned no attachment. Attachments may be disabled on this site.`,
    );
  }
  return parsed;
}
