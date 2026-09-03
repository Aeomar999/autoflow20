import { headers } from "next/headers";
import type { SearchParams } from "nuqs";
import { AcceptInvite } from "@/features/organizations/components/accept-invite";
import { auth } from "@/lib/auth";
import { HydrateClient } from "@/trpc/server";

type Props = {
  searchParams: Promise<SearchParams>;
};

/**
 * Accept-invite landing (AF-M6-09).
 *
 * Deliberately NOT behind `requireAuth`: that would redirect an unauthenticated
 * visitor to `/login` and drop the invite token. Instead the session is read
 * without redirecting and the client component sends the visitor to sign in
 * with a return URL that preserves the token, resuming acceptance on the way
 * back. The token is validated server-side by `acceptInvite` regardless of
 * what the URL carries.
 */
const Page = async ({ searchParams }: Props) => {
  const params = await searchParams;
  const rawToken = params.token;
  const token = typeof rawToken === "string" ? rawToken : null;

  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <HydrateClient>
      <AcceptInvite token={token} isAuthenticated={Boolean(session)} />
    </HydrateClient>
  );
};

export default Page;
