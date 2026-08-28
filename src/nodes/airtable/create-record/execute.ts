import "server-only";
import { NonRetriableError } from "inngest";
import { compileTemplate } from "@/features/executions/template";
import { airtableCreateRecordChannel } from "@/inngest/channels/airtable-create-record";
import type { NodeRun } from "@/nodes/types";

const AIRTABLE_API = "https://api.airtable.com/v0";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 1_000_000;

type AirtableCreateRecordData = {
  variableName?: string;
  credentialId?: string;
  baseId?: string;
  tableId?: string;
  fields?: string;
};

export const execute: NodeRun<AirtableCreateRecordData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  credentials,
}) => {
  await publish(
    airtableCreateRecordChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  try {
    const result = await step.run("airtable-create-record", async () => {
      if (!data.variableName) {
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Airtable Create Record node: Variable name not configured",
        );
      }

      if (!data.credentialId) {
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Airtable Create Record node: Airtable credential not configured",
        );
      }

      if (!data.baseId) {
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Airtable Create Record node: Base ID not configured",
        );
      }

      if (!data.tableId) {
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Airtable Create Record node: Table not configured",
        );
      }

      const apiKey = credentials?.credentialId?.apiKey;
      if (!apiKey) {
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Airtable Create Record node: Airtable credential not found",
        );
      }

      const baseId = compileTemplate(data.baseId)(context);
      const tableId = compileTemplate(data.tableId)(context);

      const fieldsSource = compileTemplate(data.fields || "{}")(context);
      let parsedFields: unknown;
      try {
        parsedFields = JSON.parse(fieldsSource);
      } catch {
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Airtable Create Record node: Fields must be a JSON object",
        );
      }

      if (
        parsedFields === null ||
        typeof parsedFields !== "object" ||
        Array.isArray(parsedFields)
      ) {
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Airtable Create Record node: Fields must be a JSON object",
        );
      }

      const fields = Object.fromEntries(
        Object.entries(parsedFields as Record<string, unknown>).map(
          ([key, value]) => [
            key,
            typeof value === "string" ? compileTemplate(value)(context) : value,
          ],
        ),
      );

      const url = new URL(
        `${AIRTABLE_API}/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`,
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fields }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const rawBody = await response.text();
      if (rawBody.length > MAX_RESPONSE_CHARS) {
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Airtable Create Record node: Response body exceeded size cap",
        );
      }

      if (!response.ok) {
        let message = rawBody;
        try {
          const errorBody = JSON.parse(rawBody) as {
            error?: { message?: string };
          };
          message = errorBody?.error?.message ?? rawBody;
        } catch {
          // Non-JSON error body (e.g. HTML) stays as-is.
        }
        await publish(
          airtableCreateRecordChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          `Airtable Create Record node: API error ${response.status}: ${message}`,
        );
      }

      const payload = JSON.parse(rawBody) as {
        id?: string;
        createdTime?: string;
        fields?: unknown;
      };

      return {
        ...context,
        [data.variableName]: {
          id: payload.id,
          createdTime: payload.createdTime,
          fields: payload.fields,
        },
      };
    });

    await publish(
      airtableCreateRecordChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      airtableCreateRecordChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
