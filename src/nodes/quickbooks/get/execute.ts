import "server-only";
import { NonRetriableError } from "inngest";
import {
  isQboEntity,
  type QboEntity,
} from "@/features/quickbooks/entity-names";
import { getEntity } from "@/features/quickbooks/server/entities";
import { resolveQboConnection } from "@/features/quickbooks/server/qbo-client";
import type { NodeRun } from "@/nodes/types";

type QboGetData = {
  variableName?: string;
  credentialId?: string;
  entity?: QboEntity;
  entityId?: string;
};

export const execute: NodeRun<QboGetData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("qbo-get", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "QuickBooks Get Record node: Variable name not configured",
      );
    }
    if (!data.entity) {
      throw new NonRetriableError(
        "QuickBooks Get Record node: Record type not configured",
      );
    }
    if (!data.entityId) {
      throw new NonRetriableError(
        "QuickBooks Get Record node: Record ID not configured",
      );
    }

    const where = "QuickBooks Get Record node";

    // Re-checked at run time, not just by the schema: a saved graph can carry
    // a type the registry no longer offers, and this value reaches a URL path.
    if (!isQboEntity(data.entity)) {
      throw new NonRetriableError(
        `${where}: "${data.entity}" is not a QuickBooks record type this node can read.`,
      );
    }

    const connection = resolveQboConnection(credentials?.credentialId, where);

    const record = await getEntity(connection, {
      entity: data.entity,
      id: resolve(data.entityId).trim(),
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        entity: data.entity,
        id: record.Id ?? null,
        record,
      },
    };
  });
