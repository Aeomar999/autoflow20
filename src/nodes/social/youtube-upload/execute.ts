import "server-only";
import { NonRetriableError } from "inngest";
import { collectFileRefs } from "@/features/files/file-ref";
import { statFile } from "@/features/files/server/file-service";
import {
  YOUTUBE_MAX_DESCRIPTION_CHARS,
  YOUTUBE_MAX_TAGS_CHARS,
  YOUTUBE_MAX_TITLE_CHARS,
} from "@/features/social/constants";
import { parseSingleFileRef } from "@/features/social/server/upload-stream";
import {
  startYouTubeUpload,
  uploadYouTubeBytes,
} from "@/features/social/server/youtube-client";
import type { NodeRun } from "@/nodes/types";

type YouTubeUploadData = {
  variableName?: string;
  credentialId?: string;
  videoRef?: string;
  title?: string;
  description?: string;
  tags?: string;
  privacyStatus?: "private" | "unlisted" | "public";
};

export const execute: NodeRun<YouTubeUploadData> = async ({
  data,
  nodeId,
  context,
  resolve,
  step,
  credentials,
  organizationId,
}) => {
  if (!data.variableName) {
    throw new NonRetriableError(
      "YouTube Upload node: Variable name not configured",
    );
  }
  if (!data.videoRef) {
    throw new NonRetriableError("YouTube Upload node: Video not configured");
  }
  if (!data.title) {
    throw new NonRetriableError("YouTube Upload node: Title not configured");
  }
  if (!organizationId) {
    throw new NonRetriableError(
      "YouTube Upload node: this run has no organization, so its files cannot be read.",
    );
  }

  const where = "YouTube Upload node";
  const secret = credentials?.credentialId;

  // The session URL is obtained in its own step so a retry of the upload does
  // not announce a second video. YouTube sessions last a week and re-PUTting
  // to one resumes rather than duplicating.
  const session = await step.run(`youtube-start:${nodeId}`, async () => {
    const title = resolve(data.title as string).trim();

    if (title.length === 0) {
      throw new NonRetriableError(
        `${where}: the title expression resolved to nothing.`,
      );
    }
    if (title.length > YOUTUBE_MAX_TITLE_CHARS) {
      throw new NonRetriableError(
        `${where}: the title is ${title.length} characters, over YouTube's ${YOUTUBE_MAX_TITLE_CHARS} limit.`,
      );
    }
    if (title.includes("<") || title.includes(">")) {
      // YouTube rejects angle brackets in a title with a 400 that names the
      // field but not the character.
      throw new NonRetriableError(
        `${where}: YouTube does not allow < or > in a video title.`,
      );
    }

    const description = data.description ? resolve(data.description) : "";
    if (description.length > YOUTUBE_MAX_DESCRIPTION_CHARS) {
      throw new NonRetriableError(
        `${where}: the description is ${description.length} characters, over YouTube's ${YOUTUBE_MAX_DESCRIPTION_CHARS} limit.`,
      );
    }

    const tags = data.tags
      ? resolve(data.tags)
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];
    const tagsLength = tags.join("").length;
    if (tagsLength > YOUTUBE_MAX_TAGS_CHARS) {
      throw new NonRetriableError(
        `${where}: the tags total ${tagsLength} characters, over YouTube's ${YOUTUBE_MAX_TAGS_CHARS} limit for the whole set.`,
      );
    }

    const fileId = parseSingleFileRef({
      rendered: resolve(data.videoRef as string),
      where,
      collect: collectFileRefs,
    });

    // Size and type come from the row, not from reading the file: the
    // resumable protocol needs both up front, and reading the bytes here would
    // defeat the streaming this node exists to do.
    const meta = await statFile({ fileId, organizationId });

    const sessionUrl = await startYouTubeUpload({
      secret,
      title,
      description,
      tags,
      privacyStatus: data.privacyStatus ?? "private",
      contentLength: meta.size,
      mimeType: meta.mimeType,
      where,
    });

    return { sessionUrl, fileId, title, size: meta.size };
  });

  const video = await step.run(`youtube-upload:${nodeId}`, async () =>
    uploadYouTubeBytes({
      sessionUrl: session.sessionUrl,
      fileId: session.fileId,
      organizationId,
      where,
    }),
  );

  return {
    ...context,
    [data.variableName]: {
      id: video.id ?? null,
      title: session.title,
      url: video.id ? `https://www.youtube.com/watch?v=${video.id}` : null,
      privacyStatus: video.status?.privacyStatus ?? data.privacyStatus ?? null,
      // YouTube processes asynchronously: "uploaded" is not "watchable".
      uploadStatus: video.status?.uploadStatus ?? null,
      bytes: session.size,
    },
  };
};
