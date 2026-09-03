"use client";

import { TRPCClientError } from "@trpc/client";
import { CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { useAcceptInvite } from "../hooks/use-organizations";
import { setActiveOrganization } from "../lib/active-org";

type State =
  | { kind: "accepting" }
  | { kind: "accepted"; organizationName: string }
  | { kind: "error"; message: string };

/**
 * Accept-invite landing (AF-M6-09).
 *
 * The invite email/link lands here with `?token=`. `acceptInvite` is a
 * protected procedure, so an unauthenticated visitor is bounced to login with
 * this page as the return target — the token survives the round trip in the
 * URL, and acceptance resumes automatically on return. On success the new
 * workspace is made active and the user is dropped into it.
 */
export const AcceptInvite = ({
  token,
  isAuthenticated,
}: {
  token: string | null;
  isAuthenticated: boolean;
}) => {
  const router = useRouter();
  const accept = useAcceptInvite();
  const [state, setState] = useState<State>({ kind: "accepting" });
  // Acceptance mutates (creates a membership, deletes the invite), and React
  // Strict Mode double-invokes effects in dev — guard so the second run does
  // not fire a second mutation that then 400s on an already-consumed token.
  const attempted = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `accept` and `router` are intentionally excluded — they get a new identity every render, and acceptance must run exactly once per (token, isAuthenticated). `token`/`isAuthenticated` are server props fixed for the page load, so this runs a single time.
  useEffect(() => {
    // The guard is set BEFORE any branch: every terminal path here (missing
    // token, redirect to login, the mutation itself) must run once. An earlier
    // cut returned from the no-token branch without setting it, and because the
    // effect closed over the `accept` mutation — whose identity changes every
    // render — each `setState` re-ran the effect, re-set the state, and looped:
    // "Maximum update depth exceeded". Setting it up front makes re-entry a
    // no-op regardless of which branch runs.
    if (attempted.current) return;
    attempted.current = true;

    if (!token) {
      setState({
        kind: "error",
        message: "This invitation link is missing its token.",
      });
      return;
    }

    if (!isAuthenticated) {
      // Send them to sign in, then straight back here to finish. The login
      // form reads `redirect` and honours it after authentication.
      const back = `/accept-invite?token=${encodeURIComponent(token)}`;
      router.replace(`/login?redirect=${encodeURIComponent(back)}`);
      return;
    }

    accept
      .mutateAsync({ token })
      .then((result) => {
        setActiveOrganization(result.organizationId);
        setState({
          kind: "accepted",
          organizationName: result.organizationName,
        });
      })
      .catch((error) => {
        setState({
          kind: "error",
          message:
            error instanceof TRPCClientError
              ? error.message
              : "This invitation could not be accepted.",
        });
      });
  }, [token, isAuthenticated]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm rounded-xl border border-hairline bg-panel p-8 text-center shadow-sm">
        {state.kind === "accepting" ? (
          <>
            <Loader2Icon className="mx-auto size-8 animate-spin text-muted-foreground" />
            <h1 className="mt-4 text-lg font-semibold">
              Accepting your invitation
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              One moment while we add you to the workspace.
            </p>
          </>
        ) : state.kind === "accepted" ? (
          <>
            <CheckCircle2Icon className="mx-auto size-8 text-success" />
            <h1 className="mt-4 text-lg font-semibold">You're in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You've joined {state.organizationName}. It's now your active
              workspace.
            </p>
            <Button
              className="mt-5 w-full"
              onClick={() => {
                // `refresh` first so server components re-resolve against the
                // newly active org, then navigate into it.
                router.refresh();
                router.push("/workflows");
              }}
            >
              Go to workspace
            </Button>
          </>
        ) : (
          <>
            <TriangleAlertIcon className="mx-auto size-8 text-danger" />
            <h1 className="mt-4 text-lg font-semibold">
              Invitation not accepted
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {state.message}
            </p>
            <Button asChild variant="outline" className="mt-5 w-full">
              <Link href="/workflows">Go to your workspaces</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
