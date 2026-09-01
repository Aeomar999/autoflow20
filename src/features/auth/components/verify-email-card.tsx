"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

type State = "verifying" | "success" | "error" | "missing";

export function VerifyEmailCard({ token }: { token?: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<State>(
    token ? "verifying" : "missing",
  );

  React.useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const run = async () => {
      const res = await authClient.verifyEmail({
        query: { token },
      });
      if (cancelled) return;
      if (res.error) {
        setState("error");
      } else {
        setState("success");
        router.push("/");
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Email verification</CardTitle>
        {state === "verifying" && (
          <CardDescription>Verifying your email address…</CardDescription>
        )}
        {state === "missing" && (
          <CardDescription>
            This verification link is missing its token. Please check the link
            in your email.
          </CardDescription>
        )}
        {state === "success" && (
          <CardDescription>
            Your email has been verified. Redirecting you…
          </CardDescription>
        )}
        {state === "error" && (
          <CardDescription>
            This verification link is invalid or has expired. Please request a
            new one.
          </CardDescription>
        )}
      </CardHeader>
      {state !== "verifying" && (
        <CardContent className="text-center text-sm">
          <Link href="/login" className="underline underline-offset-4">
            Back to login
          </Link>
        </CardContent>
      )}
    </Card>
  );
}
