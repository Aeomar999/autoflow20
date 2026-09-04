import "server-only";
import { NonRetriableError } from "inngest";
import { collectFileRefs } from "@/features/files/file-ref";
import { LINKEDIN_MAX_POST_CHARS } from "@/features/social/constants";
import {
  createLinkedInPost,
  requireAuthor,
  uploadLinkedInImage,
} from "@/features/social/server/linkedin-client";
import { parseSingleFileRef } from "@/features/social/server/upload-stream";
import type { NodeRun } from "@/nodes/types";

type LinkedInPostData = {
  variableName?: string;
  credentialId?: string;
  text?: string;
  imageRef?: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
};

export const execute: NodeRun<LinkedInPostData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
  organizationId,
}) =>
  step.run("linkedin-post", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "LinkedIn Post node: Variable name not configured",
      );
    }
    if (!data.text) {
      throw new NonRetriableError("LinkedIn Post node: Text not configured");
    }

    const where = "LinkedIn Post node";
    const text = resolve(data.text).trim();

    if (text.length === 0) {
      throw new NonRetriableError(
        `${where}: the text expression resolved to nothing.`,
      );
    }
    if (text.length > LINKEDIN_MAX_POST_CHARS) {
      throw new NonRetriableError(
        `${where}: the post is ${text.length} characters, over LinkedIn's ${LINKEDIN_MAX_POST_CHARS} limit.`,
      );
    }

    const { accessToken, authorUrn } = requireAuthor(
      credentials?.credentialId,
      where,
    );

    let assetUrn: string | undefined;
    const rendered = data.imageRef ? resolve(data.imageRef).trim() : "";

    if (rendered.length > 0) {
      if (!organizationId) {
        throw new NonRetriableError(
          `${where}: this run has no organization, so its files cannot be read.`,
        );
      }

      const fileId = parseSingleFileRef({
        rendered,
        where,
        collect: collectFileRefs,
      });

      // Register and upload BEFORE the post is created: referencing an asset
      // whose bytes have not landed produces a post with a broken image and
      // no error at all.
      assetUrn = await uploadLinkedInImage({
        accessToken,
        authorUrn,
        fileId,
        organizationId,
        where,
      });
    }

    const post = await createLinkedInPost({
      accessToken,
      authorUrn,
      text,
      assetUrn,
      visibility: data.visibility ?? "PUBLIC",
      where,
    });

    return {
      ...context,
      [data.variableName]: {
        id: post.id,
        url: `https://www.linkedin.com/feed/update/${post.id}`,
        hasImage: Boolean(assetUrn),
        visibility: data.visibility ?? "PUBLIC",
      },
    };
  });
