import "server-only";
import { NonRetriableError } from "inngest";
import { Client as PgClient } from "pg";
import { postgresQueryChannel } from "@/inngest/channels/postgres-query";
import type { NodeRun } from "@/nodes/types";

type PostgresQueryData = {
  variableName?: string;
  credentialId?: string;
  query?: string;
  params?: string;
};

/** Hard cap on rows stored in the run context — huge reads must not balloon NodeExecution.output. */
const MAX_STORED_ROWS = 10_000;
/** Bound the socket connect so a dead host fails the run instead of hanging it. */
const CONNECT_TIMEOUT_MS = 10_000;
/** Bound each statement so a lock or a slow query fails the run instead of hanging it. */
const QUERY_TIMEOUT_MS = 30_000;

export const execute: NodeRun<PostgresQueryData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  publish,
  credentials,
}) => {
  await publish(postgresQueryChannel().status({ nodeId, status: "loading" }));

  try {
    const result = await step.run("postgres-query", async () => {
      if (!data.variableName) {
        await publish(
          postgresQueryChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Postgres node: Variable name not configured",
        );
      }
      if (!data.credentialId) {
        await publish(
          postgresQueryChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Postgres node: No Postgres credential selected",
        );
      }
      const secret = credentials?.credentialId;
      if (!secret) {
        await publish(
          postgresQueryChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Postgres node: Postgres credential not found",
        );
      }
      if (!data.query) {
        await publish(
          postgresQueryChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError("Postgres node: No query configured");
      }

      let values: unknown[] | undefined;
      if (data.params) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.params);
        } catch {
          await publish(
            postgresQueryChannel().status({
              nodeId,
              status: "error",
            }),
          );
          throw new NonRetriableError(
            "Postgres node: Params must be a JSON array",
          );
        }
        if (!Array.isArray(parsed)) {
          await publish(
            postgresQueryChannel().status({
              nodeId,
              status: "error",
            }),
          );
          throw new NonRetriableError(
            "Postgres node: Params must be a JSON array",
          );
        }
        values = parsed.map((entry) =>
          typeof entry === "string" ? resolve(entry) : entry,
        );
      }

      const client = new PgClient({
        host: secret.host,
        port: Number(secret.port ?? 5432),
        database: secret.database,
        user: secret.username,
        password: secret.password,
        ssl:
          secret.ssl === "require" ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
        query_timeout: QUERY_TIMEOUT_MS,
      });

      try {
        await client.connect();
        const out = await client.query(
          values ? { text: data.query, values } : { text: data.query },
        );
        return {
          ...context,
          [data.variableName]: {
            rows: out.rows.slice(0, MAX_STORED_ROWS),
            rowCount: out.rowCount ?? 0,
            truncated: out.rows.length > MAX_STORED_ROWS,
          },
        };
      } catch (error) {
        // Cleanup only — the query outcome is decided above; a failed socket
        // teardown must not mask the real error.
        await client.end().catch(() => {});
        throw error;
      } finally {
        await client.end().catch(() => {});
      }
    });
    await publish(postgresQueryChannel().status({ nodeId, status: "success" }));
    return result;
  } catch (error) {
    await publish(postgresQueryChannel().status({ nodeId, status: "error" }));
    throw error;
  }
};
