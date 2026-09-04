import "server-only";
import { NonRetriableError } from "inngest";
import type { CredentialSecret } from "@/features/credentials/server/vault";
import { googleFetch, googleFetchBytes, paginate } from "./google-client";

/**
 * Google Drive operations (AF-M10-15).
 *
 * Automations #28, #29 and #30 all follow the same shape: watch a folder,
 * download what appears, and **move it somewhere else when done** — the move
 * is what stops the next poll reprocessing the same contract.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

/** Per-file download ceiling for a node. */
export const MAX_DRIVE_FILE_BYTES = 100 * 1024 * 1024;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
  parents: string[];
}

const FILE_FIELDS =
  "id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents";

/**
 * Google Workspace documents have no bytes to download; they must be exported.
 * Silently downloading 0 bytes for a Google Doc is the failure this maps.
 */
const WORKSPACE_EXPORTS: Record<
  string,
  { mimeType: string; extension: string }
> = {
  "application/vnd.google-apps.document": {
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
  "application/vnd.google-apps.spreadsheet": {
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
  },
  "application/vnd.google-apps.presentation": {
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    extension: "pptx",
  },
  "application/vnd.google-apps.drawing": {
    mimeType: "application/pdf",
    extension: "pdf",
  },
};

const normalizeFile = (raw: Record<string, unknown>): DriveFile => ({
  id: String(raw.id ?? ""),
  name: String(raw.name ?? ""),
  mimeType: String(raw.mimeType ?? "application/octet-stream"),
  // Drive returns size as a string, and omits it entirely for Workspace docs.
  size: Number.parseInt(String(raw.size ?? "0"), 10) || 0,
  createdTime: String(raw.createdTime ?? ""),
  modifiedTime: String(raw.modifiedTime ?? ""),
  webViewLink:
    typeof raw.webViewLink === "string" ? raw.webViewLink : undefined,
  parents: Array.isArray(raw.parents) ? (raw.parents as string[]) : [],
});

/**
 * Escape a value for a Drive `q` query.
 *
 * A folder id or name goes into a quoted string in the query language; an
 * unescaped apostrophe ends the string and the rest is parsed as syntax. The
 * same class of bug as SQL injection, in a query language people forget is one.
 */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Files in a folder, newest first, optionally only those modified since. */
export async function listDriveFiles(args: {
  secret: CredentialSecret | undefined;
  folderId: string;
  modifiedAfter?: string;
  limit: number;
  where: string;
}): Promise<{ files: DriveFile[]; truncated: boolean }> {
  const clauses = [
    `'${escapeDriveQuery(args.folderId)}' in parents`,
    "trashed = false",
  ];
  if (args.modifiedAfter) {
    clauses.push(`modifiedTime > '${escapeDriveQuery(args.modifiedAfter)}'`);
  }

  const result = await paginate({
    fetchPage: (pageToken) =>
      googleFetch<{
        files?: Array<Record<string, unknown>>;
        nextPageToken?: string;
      }>(args.secret, {
        url: DRIVE_API,
        query: {
          q: clauses.join(" and "),
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          orderBy: "modifiedTime desc",
          pageSize: 100,
          // Without these, a file in a shared drive is invisible — and shared
          // drives are where team folders actually live.
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageToken,
        },
        where: args.where,
      }),
    itemsOf: (page) => (page.files ?? []).map(normalizeFile),
    nextTokenOf: (page) => page.nextPageToken,
    limit: args.limit,
  });

  return { files: result.items, truncated: result.truncated };
}

export async function getDriveFile(args: {
  secret: CredentialSecret | undefined;
  fileId: string;
  where: string;
}): Promise<DriveFile> {
  const raw = await googleFetch<Record<string, unknown>>(args.secret, {
    url: `${DRIVE_API}/${encodeURIComponent(args.fileId)}`,
    query: { fields: FILE_FIELDS, supportsAllDrives: true },
    where: args.where,
  });
  return normalizeFile(raw);
}

/**
 * Download a file's bytes.
 *
 * A Google Doc, Sheet or Slides file has no bytes: `alt=media` returns an
 * error for it. Those are exported to their Office equivalent instead, and the
 * caller is told which happened so the filename and MIME type match what it
 * actually got.
 */
export async function downloadDriveFile(args: {
  secret: CredentialSecret | undefined;
  file: DriveFile;
  maxBytes?: number;
  where: string;
}): Promise<{
  data: Buffer;
  filename: string;
  mimeType: string;
  exported: boolean;
}> {
  const maxBytes = Math.min(
    args.maxBytes ?? MAX_DRIVE_FILE_BYTES,
    MAX_DRIVE_FILE_BYTES,
  );
  const exportAs = WORKSPACE_EXPORTS[args.file.mimeType];

  if (exportAs) {
    const data = await googleFetchBytes(args.secret, {
      url: `${DRIVE_API}/${encodeURIComponent(args.file.id)}/export`,
      query: { mimeType: exportAs.mimeType },
      maxBytes,
      where: args.where,
    });
    return {
      data,
      filename: args.file.name.includes(".")
        ? args.file.name
        : `${args.file.name}.${exportAs.extension}`,
      mimeType: exportAs.mimeType,
      exported: true,
    };
  }

  if (args.file.mimeType.startsWith("application/vnd.google-apps.")) {
    // A Form, a Site, a shortcut — no bytes and no export. Better to name it
    // than to hand the caller an empty file.
    throw new NonRetriableError(
      `${args.where}: "${args.file.name}" is a ${args.file.mimeType}, which has no downloadable content.`,
    );
  }

  const data = await googleFetchBytes(args.secret, {
    url: `${DRIVE_API}/${encodeURIComponent(args.file.id)}`,
    query: { alt: "media", supportsAllDrives: true },
    maxBytes,
    where: args.where,
  });

  return {
    data,
    filename: args.file.name,
    mimeType: args.file.mimeType,
    exported: false,
  };
}

/** Upload bytes as a new file in a folder. */
export async function uploadDriveFile(args: {
  secret: CredentialSecret | undefined;
  folderId?: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  where: string;
}): Promise<DriveFile> {
  // Multipart: metadata and bytes in one request. The alternative is a
  // resumable session, which is three round trips for a file this size.
  const boundary = `----autoflow_${Date.now().toString(36)}`;
  const metadata = JSON.stringify({
    name: args.filename,
    ...(args.folderId ? { parents: [args.folderId] } : {}),
  });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${args.mimeType}\r\n\r\n`,
      "utf-8",
    ),
    args.data,
    Buffer.from(`\r\n--${boundary}--`, "utf-8"),
  ]);

  const raw = await googleFetch<Record<string, unknown>>(args.secret, {
    url: DRIVE_UPLOAD_API,
    method: "POST",
    query: {
      uploadType: "multipart",
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    },
    rawBody: {
      data: body,
      contentType: `multipart/related; boundary=${boundary}`,
    },
    where: args.where,
  });

  return normalizeFile(raw);
}

/**
 * Move a file between folders.
 *
 * Drive has no "move": it is a parent swap, and the old parent must be named
 * explicitly. Reading the file first is what makes the move idempotent — a
 * retried step that removed a parent the file no longer has would fail.
 */
export async function moveDriveFile(args: {
  secret: CredentialSecret | undefined;
  fileId: string;
  toFolderId: string;
  where: string;
}): Promise<DriveFile> {
  const current = await getDriveFile({
    secret: args.secret,
    fileId: args.fileId,
    where: args.where,
  });

  if (current.parents.includes(args.toFolderId)) {
    // Already there. A retry after a partial failure lands here, and failing
    // would turn a successful move into a failed run.
    return current;
  }

  const raw = await googleFetch<Record<string, unknown>>(args.secret, {
    url: `${DRIVE_API}/${encodeURIComponent(args.fileId)}`,
    method: "PATCH",
    query: {
      addParents: args.toFolderId,
      removeParents: current.parents.join(","),
      fields: FILE_FIELDS,
      supportsAllDrives: true,
    },
    body: {},
    where: args.where,
  });

  return normalizeFile(raw);
}
