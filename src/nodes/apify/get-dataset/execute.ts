import "server-only";
import { NonRetriableError } from "inngest";
import { APIFY_DEFAULT_ITEMS } from "@/features/apify/constants";
import { fetchApifyDataset } from "@/features/apify/server/apify-client";
import type { NodeRun } from "@/nodes/types";

type ApifyDatasetData = {
  variableName?: string;
  credentialId?: string;
  datasetId?: string;
  limit?: number;
  offset?: number;
  clean?: boolean;
};

export const execute: NodeRun<ApifyDatasetData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("apify-get-dataset", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Apify Dataset node: Variable name not configured",
      );
    }
    if (!data.datasetId) {
      throw new NonRetriableError("Apify Dataset node: Dataset not configured");
    }

    const where = "Apify Dataset node";
    const datasetId = resolve(data.datasetId).trim();

    if (datasetId.length === 0) {
      // Almost always an Apify Run node that did not finish, so its
      // `datasetId` resolved to nothing. Saying that beats a 404.
      throw new NonRetriableError(
        `${where}: the dataset expression resolved to nothing. If it points at an Apify Run node, that run may not have completed.`,
      );
    }

    const { items, truncated } = await fetchApifyDataset<
      Record<string, unknown>
    >({
      secret: credentials?.credentialId,
      datasetId,
      limit: data.limit ?? APIFY_DEFAULT_ITEMS,
      offset: data.offset ?? 0,
      clean: data.clean ?? true,
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        datasetId,
        items,
        count: items.length,
        // Reported, never silent: a workflow that processed the first thousand
        // of forty thousand rows otherwise looks like it worked.
        truncated,
      },
    };
  });
