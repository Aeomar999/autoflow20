"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Post-checkout landing page (AF-M0-10). POLAR_SUCCESS_URL targets this route;
 * the Better Auth checkout plugin substitutes `{CHECKOUT_ID}` in the URL.
 *
 * The sidebar reads subscription state from the ["subscription"] React Query
 * cache (useSubscription) — invalidate it on mount so the upgrade button
 * flips to the billing-portal state immediately, without a full reload.
 */
const BillingSuccessPage = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["subscription"] });
  }, [queryClient]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle2Icon className="size-6 text-green-600" />
          </div>
          <CardTitle>You're on Pro</CardTitle>
          <CardDescription>
            Your subscription is active. Premium actions are unlocked right away
            — no reload needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href="/workflows">Back to workflows</Link>
          </Button>
          <Button variant="outline" asChild className="w-full">
            <Link href="/credentials">Add credentials</Link>
          </Button>
          <p className="text-xs text-muted-foreground">
            Manage invoices and cancellation anytime via the billing portal in
            the sidebar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default BillingSuccessPage;
