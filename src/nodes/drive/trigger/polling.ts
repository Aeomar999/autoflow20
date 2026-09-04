import "server-only";
import { listDriveFiles } from "@/features/google/server/drive";
import type { PollingTrigger } from "@/nodes/types";

type DriveTriggerConfig = { folderId?: string };
type DriveCursor = { modifiedAfter?: string };

/**
 * `DRIVE_TRIGGER`'s poller (AF-M10-15 on the AF-M10-05 framework).
 *
 * Drive DOES have a usable "since" cursor — `modifiedTime` — so unlike Sheets
 * and Gmail this poller narrows the query itself rather than fetching a window
 * and letting the id set do all the work. The id window still runs underneath:
 * `modifiedTime >` is evaluated against a clock that is not ours, and a file
 * saved in the same second as the cursor comes back twice.
 */
export const polling: PollingTrigger<DriveTriggerConfig> = {
  defaultIntervalSeconds: 300,

  async poll({ config, credentials, cursor, limit }) {
    if (!config.folderId) {
      throw new Error("Drive trigger: a folder must be configured.");
    }

    const previous = (cursor ?? {}) as DriveCursor;

    const { files } = await listDriveFiles({
      secret: credentials?.credentialId,
      folderId: config.folderId.trim(),
      modifiedAfter: previous.modifiedAfter,
      limit,
      where: "Drive trigger",
    });

    // The newest modifiedTime SEEN, not "now": using the local clock would
    // skip anything written between the request and the response, and those
    // are exactly the files this trigger exists to catch.
    const newest = files.reduce(
      (latest, file) =>
        file.modifiedTime > latest ? file.modifiedTime : latest,
      previous.modifiedAfter ?? "",
    );

    return {
      items: files.map((file) => ({
        id: file.id,
        data: { file },
      })),
      cursor: {
        modifiedAfter: newest || previous.modifiedAfter,
      } satisfies DriveCursor,
    };
  },
};
