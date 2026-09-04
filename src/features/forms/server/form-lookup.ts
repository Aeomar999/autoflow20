import "server-only";
import prisma from "@/lib/db";
import { logger } from "@/lib/logger";
import { type FormField, parseFormFields } from "../form-schema";

/**
 * Finding the published form behind a public URL (AF-M10-14).
 *
 * Shared by the page that renders the form and the route that accepts it, so
 * the two cannot disagree about whether a form exists — a renderer that shows
 * a form the submit route 404s is worse than showing nothing.
 */

export interface PublishedForm {
  workflowId: string;
  organizationId: string;
  userId: string;
  nodeId: string;
  title: string;
  description?: string;
  submitLabel: string;
  successMessage: string;
  fields: FormField[];
  /** Extra path segment the URL must carry, when the author set one. */
  pathSecret?: string;
  plan: string | null;
}

type SnapshotNode = {
  id?: string;
  type?: string;
  disabled?: boolean;
  data?: Record<string, unknown>;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

/**
 * The form a workflow publishes, or null.
 *
 * Null for every reason a caller must not be able to tell apart: no such
 * workflow, no published version, no form trigger, a disabled one, or the
 * wrong path segment. Both callers turn null into the same 404, so a prober
 * cannot learn which workflows exist.
 */
export async function findPublishedForm(args: {
  workflowId: string;
  /** The segment after the workflow id, when the URL carried one. */
  pathSegment?: string;
}): Promise<PublishedForm | null> {
  const workflow = await prisma.workflow.findUnique({
    where: { id: args.workflowId },
    select: {
      id: true,
      userId: true,
      organizationId: true,
      activeVersionId: true,
      activeVersion: { select: { graphSnapshot: true } },
      organization: { select: { plan: true } },
    },
  });

  if (!workflow?.activeVersionId || !workflow.activeVersion?.graphSnapshot) {
    return null;
  }

  let nodes: SnapshotNode[];
  try {
    const snapshot =
      typeof workflow.activeVersion.graphSnapshot === "string"
        ? (JSON.parse(workflow.activeVersion.graphSnapshot) as {
            nodes?: SnapshotNode[];
          })
        : (workflow.activeVersion.graphSnapshot as { nodes?: SnapshotNode[] });
    nodes = snapshot.nodes ?? [];
  } catch (error) {
    logger.error("Failed to parse graphSnapshot for a hosted form", {
      workflowId: args.workflowId,
      error,
    });
    return null;
  }

  const node = nodes.find(
    (candidate) => candidate?.type === "FORM_TRIGGER" && candidate.id,
  );
  if (!node?.id) {
    return null;
  }

  // AF-M9-17: a disabled trigger cannot start a run, so its form must not
  // exist either — showing a form that cannot submit is the worse failure.
  if (node.disabled === true) {
    return null;
  }

  const data = node.data ?? {};
  const pathSecret = asString(data.pathSecret);

  // Obscurity, not authentication — and compared as such. It is in the URL,
  // so it is in browser history, in referrer headers and in server logs; a
  // constant-time compare here would imply a secrecy the design does not have.
  if ((pathSecret ?? "") !== (args.pathSegment ?? "")) {
    return null;
  }

  return {
    workflowId: workflow.id,
    organizationId: workflow.organizationId,
    userId: workflow.userId,
    nodeId: node.id,
    title: asString(data.title) ?? "Submit a request",
    description: asString(data.description),
    submitLabel: asString(data.submitLabel) ?? "Submit",
    successMessage:
      asString(data.successMessage) ?? "Thanks — your submission was received.",
    fields: parseFormFields(data.fields),
    pathSecret,
    plan: workflow.organization?.plan ?? null,
  };
}
