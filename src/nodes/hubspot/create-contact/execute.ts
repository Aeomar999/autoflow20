import "server-only";
import { NonRetriableError } from "inngest";
import { compileTemplate } from "@/features/executions/template";
import { hubspotCreateContactChannel } from "@/inngest/channels/hubspot-create-contact";
import type { NodeRun } from "@/nodes/types";

const HUBSPOT_API = "https://api.hubapi.com/crm/v3";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_CHARS = 1_000_000;

type HubSpotCreateContactData = {
  variableName?: string;
  credentialId?: string;
  properties?: string;
};

export const execute: NodeRun<HubSpotCreateContactData> = async ({
  data,
  nodeId,
  context,
  step,
  publish,
  credentials,
}) => {
  await publish(
    hubspotCreateContactChannel().status({
      nodeId,
      status: "loading",
    }),
  );

  try {
    const result = await step.run("hubspot-create-contact", async () => {
      if (!data.variableName) {
        await publish(
          hubspotCreateContactChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "HubSpot Create Contact node: Variable name not configured",
        );
      }

      if (!data.credentialId) {
        await publish(
          hubspotCreateContactChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "HubSpot Create Contact node: HubSpot credential not configured",
        );
      }

      const apiKey = credentials?.credentialId?.apiKey;
      if (!apiKey) {
        await publish(
          hubspotCreateContactChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "HubSpot Create Contact node: HubSpot credential not found",
        );
      }

      const propertiesSource = compileTemplate(data.properties || "{}")(
        context,
      );
      let parsedProperties: unknown;
      try {
        parsedProperties = JSON.parse(propertiesSource);
      } catch {
        await publish(
          hubspotCreateContactChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "HubSpot Create Contact node: Properties must be a JSON object",
        );
      }

      if (
        parsedProperties === null ||
        typeof parsedProperties !== "object" ||
        Array.isArray(parsedProperties)
      ) {
        await publish(
          hubspotCreateContactChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "HubSpot Create Contact node: Properties must be a JSON object",
        );
      }

      const properties = Object.fromEntries(
        Object.entries(parsedProperties as Record<string, unknown>).map(
          ([key, value]) => [
            key,
            typeof value === "string" ? compileTemplate(value)(context) : value,
          ],
        ),
      );

      const url = new URL(`${HUBSPOT_API}/objects/contacts`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      const rawBody = await response.text();
      if (rawBody.length > MAX_RESPONSE_CHARS) {
        await publish(
          hubspotCreateContactChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          "HubSpot Create Contact node: Response body exceeded size cap",
        );
      }

      if (!response.ok) {
        let message = rawBody;
        try {
          const errorBody = JSON.parse(rawBody) as {
            message?: string;
          };
          message = errorBody?.message ?? rawBody;
        } catch {
          // Non-JSON error body (e.g. HTML) stays as-is.
        }
        await publish(
          hubspotCreateContactChannel().status({
            nodeId,
            status: "error",
          }),
        );
        throw new NonRetriableError(
          `HubSpot Create Contact node: API error ${response.status}: ${message}`,
        );
      }

      const payload = JSON.parse(rawBody) as {
        id?: string;
        properties?: Record<string, string>;
        createdAt?: string;
        updatedAt?: string;
        archived?: boolean;
      };

      return {
        ...context,
        [data.variableName]: {
          id: payload.id,
          properties: payload.properties,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
          archived: payload.archived,
        },
      };
    });

    await publish(
      hubspotCreateContactChannel().status({
        nodeId,
        status: "success",
      }),
    );

    return result;
  } catch (error) {
    await publish(
      hubspotCreateContactChannel().status({
        nodeId,
        status: "error",
      }),
    );
    throw error;
  }
};
