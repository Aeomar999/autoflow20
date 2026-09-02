"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Panel, PanelBody } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";

/**
 * Post-checkout landing page (AF-M0-10). The Polar checkout plugin redirects
 * here via the relative `successUrl` set in src/lib/auth.ts, which it resolves
 * against the request's own host; it substitutes `{CHECKOUT_ID}` in the URL.
 *
 * The sidebar reads subscription state from the ["subscription"] React Query
 * cache (useSubscription), so invalidate it on mount and the upgrade button
 * flips to the billing-portal state immediately, without a full reload.
 */
const BillingSuccessPage = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["subscription"] });
  }, [queryClient]);

  return (
    <div className="flex min-h-full flex-1 items-center justify-center bg-surface p-6">
      <Panel className="w-full max-w-md">
        <PanelBody className="flex flex-col items-center gap-4 p-8 text-center">
          <span className="flex size-11 items-center justify-center rounded-full border border-success/25 bg-success/10">
            <CheckCircle2Icon className="size-5 text-success" />
          </span>
          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold tracking-tight">
              You are on Pro
            </h1>
            <p className="text-sm text-muted-foreground">
              Your subscription is active. Premium actions are unlocked right
              away, with no reload needed.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 pt-1">
            <Button asChild className="w-full">
              <Link href="/workflows">Back to workflows</Link>
            </Button>
            <Button
              variant="outline"
              asChild
              className="w-full border-hairline bg-panel"
            >
              <Link href="/credentials">Add credentials</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Manage invoices and cancellation anytime from the billing portal in
            the sidebar.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
};

export default BillingSuccessPage;
