import { checkout, polar, portal, webhooks } from "@polar-sh/better-auth";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { resolveTrustedOrigins } from "@/lib/auth-origins";
import prisma from "@/lib/db";
import { sendPasswordResetEmail, sendVerificationEmail } from "@/lib/email";
import {
  polarProductId,
  polarProductSlug,
  polarWebhookSecret,
} from "@/lib/env";
import { updatePlanFromWebhook } from "./auth-webhooks";
import { polarClient } from "./polar";

export const auth = betterAuth({
  // Explicit rather than inferred: Better Auth matches the request `Origin`
  // against this, and an inferred value silently becomes localhost in a
  // deployed environment — which is the "Invalid origin" sign-up failure.
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: resolveTrustedOrigins({
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NGROK_URL: process.env.NGROK_URL,
    // Injected per deployment by Vercel; the only way preview URLs, which
    // differ per branch, can be trusted without hardcoding them.
    VERCEL_URL: process.env.VERCEL_URL,
  }),
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    // AF-M8-04: password reset delivered via Resend. When RESEND_API_KEY is
    // unset the sender throws, so the reset action fails loudly rather than
    // silently pretending an email went out.
    sendResetPassword: async (data) => {
      await sendPasswordResetEmail(data);
    },
  },
  // AF-M8-04: verify email addresses on signup. `sendOnSignUp` emails a
  // verification link automatically; `autoSignInAfterVerification` signs the
  // user in once they click it. `requireEmailVerification` is intentionally
  // NOT set so existing unverified users are not locked out.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async (data) => {
      await sendVerificationEmail(data);
    },
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  plugins: [
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          // AF-M0-03: product comes from env. When POLAR_PRODUCT_ID is unset
          // (billing unconfigured) the list stays empty and checkout simply
          // has no product mapped - the app still boots.
          products: [
            ...(polarProductId
              ? [{ productId: polarProductId, slug: polarProductSlug }]
              : []),
          ],
          // Relative so the plugin resolves it against the request's own host
          // (new URL(successUrl, ctx.request.url)). This removes the
          // POLAR_SUCCESS_URL env var and the class of bug where a stale
          // absolute value (e.g. http://localhost:3000) is baked into Polar's
          // hosted checkout and the customer is redirected to the wrong host
          // after paying. Relative => production resolves to production.
          successUrl: "/workflows/billing/success",
          authenticatedUsersOnly: true,
        }),
        portal(),
        webhooks({
          // AF-M8-23. Typed as required by the plugin but checked at runtime:
          // with no secret every delivery is rejected with 400 before a
          // handler runs, so an unconfigured install cannot be spoofed into
          // granting a plan.
          secret: polarWebhookSecret as string,
          onSubscriptionActive: async (payload) =>
            updatePlanFromWebhook(
              payload.data.customer?.externalId,
              payload.data.productId,
              false,
            ),
          onSubscriptionUpdated: async (payload) =>
            updatePlanFromWebhook(
              payload.data.customer?.externalId,
              payload.data.productId,
              false,
            ),
          onSubscriptionCanceled: async (payload) =>
            updatePlanFromWebhook(
              payload.data.customer?.externalId,
              payload.data.productId,
              true,
            ),
          onSubscriptionRevoked: async (payload) =>
            updatePlanFromWebhook(
              payload.data.customer?.externalId,
              payload.data.productId,
              true,
            ),
        }),
      ],
    }),
  ],
});
