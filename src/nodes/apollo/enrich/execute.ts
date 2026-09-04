import "server-only";
import { NonRetriableError } from "inngest";
import {
  type ApolloOrganization,
  type ApolloPerson,
  apolloFetch,
  shapeOrganization,
  shapePerson,
} from "@/features/apollo/server/apollo-client";
import type { NodeRun } from "@/nodes/types";

type ApolloEnrichData = {
  variableName?: string;
  credentialId?: string;
  mode?: "person" | "organization";
  email?: string;
  firstName?: string;
  lastName?: string;
  domain?: string;
  revealPersonalEmails?: boolean;
};

export const execute: NodeRun<ApolloEnrichData> = async ({
  data,
  context,
  resolve,
  step,
  credentials,
}) =>
  step.run("apollo-enrich", async () => {
    if (!data.variableName) {
      throw new NonRetriableError(
        "Apollo Enrich node: Variable name not configured",
      );
    }

    const where = "Apollo Enrich node";
    const secret = credentials?.credentialId;
    const mode = data.mode ?? "person";

    const email = data.email ? resolve(data.email).trim() : "";
    const firstName = data.firstName ? resolve(data.firstName).trim() : "";
    const lastName = data.lastName ? resolve(data.lastName).trim() : "";
    const domain = data.domain
      ? resolve(data.domain)
          .trim()
          .toLowerCase()
          // People paste a homepage URL. Apollo wants a bare domain and
          // answers a confident no-match for anything else.
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .replace(/\/.*$/, "")
      : "";

    if (mode === "organization") {
      if (!domain) {
        throw new NonRetriableError(
          `${where}: organization mode needs a company domain.`,
        );
      }

      const result = await apolloFetch<{ organization?: ApolloOrganization }>(
        secret,
        {
          path: "/organizations/enrich",
          body: { domain },
          where,
        },
      );

      const org = result.organization;
      return {
        ...context,
        [data.variableName]: {
          mode,
          // A miss is reported, not thrown: enriching a list must not stop
          // because one company is unknown to Apollo.
          found: Boolean(org?.id ?? org?.name),
          query: { domain },
          organization: org ? shapeOrganization(org) : null,
        },
      };
    }

    // Apollo can match on an email alone, or on a name plus a company. A name
    // with neither an email nor a domain matches almost anyone, so it is
    // refused rather than spending a credit on a guess.
    if (!email && !(firstName && domain) && !(lastName && domain)) {
      throw new NonRetriableError(
        `${where}: not enough to match on. Supply an email, or a name together with the company domain — a name alone matches too many people to be worth a credit.`,
      );
    }

    const result = await apolloFetch<{ person?: ApolloPerson }>(secret, {
      path: "/people/match",
      body: {
        ...(email ? { email } : {}),
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        ...(domain ? { domain } : {}),
        // Off by default: revealing an email spends extra credits, so it is
        // something a workflow opts into rather than pays for by accident.
        reveal_personal_emails: data.revealPersonalEmails ?? false,
      },
      where,
    });

    const person = result.person;

    return {
      ...context,
      [data.variableName]: {
        mode,
        // Apollo answers a no-match with `{"person": null}` and HTTP 200, so
        // this is the only thing distinguishing "not found" from "found".
        found: Boolean(person?.id),
        query: { email, firstName, lastName, domain },
        person: person ? shapePerson(person) : null,
      },
    };
  });
