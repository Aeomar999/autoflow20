/**
 * Persist the active-workspace choice (AF-M6-07).
 *
 * `resolveActiveOrg` in `src/trpc/init.ts` already reads an
 * `autoflow_active_org` cookie — and, critically, looks up the caller's
 * membership of that organization before honouring it, falling back to their
 * owner membership when the id is absent, unknown, or one they do not belong
 * to. So this cookie is a *preference*, not a credential: writing an arbitrary
 * value into it grants nothing.
 *
 * That is why it can be set from the client at all, and why it is not
 * `httpOnly` — the server half of the switcher already existed and had no
 * writer, which is why `app-sidebar.tsx` carried the note "There is no
 * switcher yet: … nothing persists a choice".
 */

export const ACTIVE_ORG_COOKIE = "autoflow_active_org";

/** One year — the choice should outlive the session, like a UI preference. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Record the workspace the user switched into.
 *
 * `SameSite=Lax` rather than `Strict`: the cookie has to survive a top-level
 * navigation back into the app (an emailed link, an OAuth round trip), and
 * because it confers no authority a cross-site GET carrying it is harmless.
 * `Secure` only off localhost, where it would stop the cookie being stored at
 * all over plain HTTP.
 */
export function setActiveOrganization(organizationId: string): void {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // biome-ignore lint/suspicious/noDocumentCookie: a non-httpOnly preference cookie is the intended mechanism — the server verifies membership before honouring it (see the file header), so it confers no authority and must be readable/writable from the client.
  document.cookie = `${ACTIVE_ORG_COOKIE}=${encodeURIComponent(
    organizationId,
  )}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}
