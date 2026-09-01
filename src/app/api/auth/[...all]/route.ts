import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { tryRateLimited } from "@/lib/rate-limit/auth-route";

const { POST: rawPost, GET } = toNextJsHandler(auth);

/**
 * Rate-limit credential endpoints (sign-in/sign-up/password-reset) before they
 * reach Better Auth. Reads only a clone of the body, so the request handed to
 * Better Auth is untouched. Non-credential auth routes pass straight through.
 */
async function POST(request: Request): Promise<Response> {
  const blocked = await tryRateLimited(request, new URL(request.url).pathname);
  if (blocked) return blocked;
  return rawPost(request);
}

export { POST, GET };
