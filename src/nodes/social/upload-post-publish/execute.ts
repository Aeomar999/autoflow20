import "server-only";
import { NonRetriableError } from "inngest";
import { collectFileRefs } from "@/features/files/file-ref";
import {
  publishViaUploadPost,
  UPLOAD_POST_MAX_CAPTION_CHARS,
} from "@/features/social/server/upload-post-client";
import { parseSingleFileRef } from "@/features/social/server/upload-stream";
import type { NodeRun } from "@/nodes/types";

type UploadPostData = {
  variableName?: string;
  credentialId?: string;
  profile?: string;
  platforms?: string;
  caption?: string;
  mediaRef?: string;
  isVideo?: boolean;
};

export const execute: NodeRun<UploadPostData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
  organizationId,
}) =>
  step.run("upload-post-publish", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Upload-Post node: Variable name not configured",
      );
    }
    if (!data.profile) {
      throw new NonRetriableError("Upload-Post node: Profile not configured");
    }
    if (!data.mediaRef) {
      throw new NonRetriableError("Upload-Post node: Media not configured");
    }
    if (!organizationId) {
      throw new NonRetriableError(
        "Upload-Post node: this run has no organization, so its files cannot be read.",
      );
    }

    const where = "Upload-Post node";
    const caption = data.caption ? resolve(data.caption) : "";

    if (caption.length > UPLOAD_POST_MAX_CAPTION_CHARS) {
      throw new NonRetriableError(
        `${where}: the caption is ${caption.length} characters, over Instagram's ${UPLOAD_POST_MAX_CAPTION_CHARS} limit.`,
      );
    }

    const platforms = (data.platforms ?? "instagram")
      .split(",")
      .map((platform) => platform.trim().toLowerCase())
      .filter(Boolean);

    if (platforms.length === 0) {
      throw new NonRetriableError(
        `${where}: no platforms configured, so there is nowhere to publish.`,
      );
    }

    const fileId = parseSingleFileRef({
      rendered: resolve(data.mediaRef),
      where,
      collect: collectFileRefs,
    });

    const { published, failed } = await publishViaUploadPost({
      secret: credentials?.credentialId,
      profile: resolve(data.profile).trim(),
      platforms,
      caption,
      fileId,
      organizationId,
      isVideo: data.isVideo ?? true,
      where,
    });

    // Every platform failed: that is a failed run, not a successful one with a
    // sad report. Upload-Post answers 200 either way, so the node decides.
    if (published.length === 0) {
      throw new NonRetriableError(
        `${where}: nothing was published. ${failed
          .map((entry) => `${entry.platform}: ${entry.error}`)
          .join("; ")}`,
      );
    }

    return {
      ...context,
      [data.variableName]: {
        published,
        // A partial failure is reported rather than thrown: two platforms out
        // of three is a real outcome the workflow may want to act on.
        failed,
        partial: failed.length > 0,
        caption,
      },
    };
  });
