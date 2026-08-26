import "dotenv/config";
import { spawnSync } from "node:child_process";

/**
 * Cross-platform replacement for the old shell-only script
 * (`ngrok http --url=$NGROK_URL 3000`), which broke on Windows: cmd.exe
 * does not expand $VAR, so ngrok received the literal hostname
 * "$ngrok_url" (ERR_NGROK_314).
 *
 * Reads NGROK_URL from .env (via dotenv) and forwards :3000 to your
 * reserved static domain. Requires a one-time
 * `ngrok config add-authtoken <token>`.
 */
const url = process.env.NGROK_URL;

if (!url) {
  console.error(
    "NGROK_URL is not set. Claim a free static domain at\n" +
      "https://dashboard.ngrok.com (Universal Gateway -> Domains), then\n" +
      'add NGROK_URL="your-domain.ngrok-free.app" to .env.',
  );
  process.exit(1);
}

const result = spawnSync(
  "ngrok",
  ["http", `--url=${url}`, "3000"],
  // Windows resolves ngrok through a shim; a shell is required to find it.
  { stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
