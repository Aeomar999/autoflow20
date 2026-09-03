"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { ReactNode } from "react";
import superjson from "superjson";
import { TRPCProvider } from "./client";
import type { AppRouter } from "./routers/_app";

/**
 * Test-only tRPC context (AF-M10-01).
 *
 * Any component that calls `useTRPC()` throws outside a provider, and since
 * AF-M10-01 the schema-driven config panel does — the generic credential
 * picker queries `credentials.list`. Every DOM test that renders a node's
 * config form therefore needs a context, and hand-rolling one per file would
 * be a dozen copies of the same eight lines.
 *
 * The link points at a URL nothing serves. That is deliberate: these tests
 * assert what the panel renders, not what the server returns, so a query that
 * never resolves leaves the picker in its loading state and the assertions
 * stay about the component. A test that needs data mocks the query itself.
 *
 * Lives outside a `.test.tsx` file because several test files import it;
 * nothing in production code may.
 */
export function TRPCTestProvider({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });
  const trpcClient = createTRPCClient<AppRouter>({
    links: [httpLink({ transformer: superjson, url: "http://test.invalid" })],
  });

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
