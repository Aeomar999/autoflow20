import "server-only";
import { NonRetriableError } from "inngest";
import { googleSheetsAppendChannel } from "@/inngest/channels/google-sheets-append";
import type { NodeRun } from "@/nodes/types";

const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 1_000_000;

type GoogleSheetsAppendData = {
  variableName?: string;
  credentialId?: string;
  spreadsheetId?: string;
  sheetName?: string;
  values?: string;
};

export const execute: NodeRun<GoogleSheetsAppendData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  publish,
  credentials,
}) => {
  await publish(
    googleSheetsAppendChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  try {
    const result = await step.run("google-sheets-append", async () => {
      if (!data.variableName) {
        await publish(
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Google Sheets Append node: Variable name not configured",
        );
      }

      if (!data.credentialId) {
        await publish(
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Google Sheets Append node: Google credential not configured",
        );
      }

      if (!data.spreadsheetId) {
        await publish(
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Google Sheets Append node: Spreadsheet ID not configured",
        );
      }

      if (!data.sheetName) {
        await publish(
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Google Sheets Append node: Sheet not configured",
        );
      }

      const accessToken = credentials?.credentialId?.accessToken;
      if (!accessToken) {
        await publish(
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Google Sheets Append node: Google credential not found",
        );
      }

      const spreadsheetId = resolve(data.spreadsheetId);
      const range = resolve(data.sheetName);

      const valuesSource = resolve(data.values || "[]");
      let parsed: unknown;
      try {
        parsed = JSON.parse(valuesSource);
      } catch {
        await publish(
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Google Sheets Append node: Values must be a JSON array of rows",
        );
      }

      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        !parsed.every((row) => Array.isArray(row))
      ) {
        await publish(
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Google Sheets Append node: Values must be a JSON array of rows",
        );
      }

      const rows = (parsed as unknown[]).map((row) =>
        (row as unknown[]).map((cell) => {
          if (typeof cell === "string") {
            return resolve(cell);
          }
          return cell;
        }),
      );

      const url = new URL(
        `${GOOGLE_SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append`,
      );
      url.searchParams.set("valueInputOption", "USER_ENTERED");

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: rows }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const rawBody = await response.text();
      if (rawBody.length > MAX_RESPONSE_CHARS) {
        await publish(
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "Google Sheets Append node: Response body exceeded size cap",
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
          googleSheetsAppendChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          `Google Sheets Append node: API error ${response.status}: ${message}`,
        );
      }

      const payload = JSON.parse(rawBody) as {
        spreadsheetId?: string;
        tableRange?: string;
        updates?: unknown;
      };

      return {
        ...context,
        [data.variableName]: {
          spreadsheetId: payload.spreadsheetId,
          tableRange: payload.tableRange,
          updates: payload.updates,
        },
      };
    });

    await publish(
      googleSheetsAppendChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      googleSheetsAppendChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
