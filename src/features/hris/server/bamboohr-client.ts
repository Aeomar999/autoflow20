import "server-only";
import { NonRetriableError, RetryAfterError } from "inngest";

import type { CredentialSecret } from "@/features/credentials/server/vault";
import { serviceEndpoint } from "@/lib/server/service-endpoints";

/**
 * BambooHR client for the AF-M11-10 HRIS trigger.
 *
 * One read: the employee directory. It is the cheapest authenticated list
 * BambooHR offers and the only thing the lifecycle needs — an employee that
 * appears in the directory is a person the `employee.hired` handoff should be
 * told about.
 *
 * The directory is a FULL list, not a "since" feed. That is deliberate on
 * BambooHR's side and fine here: the polling framework (ADR-0024) owns the
 * dedupe window and suppresses the first poll entirely, so activating against
 * a 400-person company starts zero runs rather than four hundred.
 */

const REQUEST_TIMEOUT_MS = 30_000;

/** BambooHR company subdomains are alphanumerics and hyphens. */
const COMPANY_DOMAIN = /^[A-Za-z0-9-]{1,64}$/;

export interface BambooHrEmployee {
  id: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  workEmail: string | null;
  jobTitle: string | null;
  department: string | null;
  supervisorEmail: string | null;
  hireDate: string | null;
}

interface DirectoryResponse {
  employees?: unknown;
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function classify(status: number, where: string, retryAfter: string | null) {
  if (status === 401 || status === 403) {
    return new NonRetriableError(
      `${where}: BambooHR rejected the credential (${status}). Check the API key and that the company domain matches the account it was issued for.`,
    );
  }
  if (status === 404) {
    return new NonRetriableError(
      `${where}: BambooHR returned 404. The company domain is the subdomain of your BambooHR URL — "acme" in https://acme.bamboohr.com.`,
    );
  }
  if (status === 429) {
    const seconds = Number(retryAfter);
    return new RetryAfterError(
      `${where}: BambooHR rate-limited the request.`,
      Number.isFinite(seconds) && seconds > 0 ? seconds : 60,
    );
  }
  if (status >= 500) {
    // Retriable: the framework's backoff will space the next attempt out.
    return new Error(`${where}: BambooHR returned ${status}.`);
  }
  return new NonRetriableError(`${where}: BambooHR returned ${status}.`);
}

/**
 * Read the employee directory.
 *
 * `secret` is the resolved credential envelope; its values are used to build
 * the Authorization header and are never logged, returned, or put in an error
 * message (`engineering_rules.md` §10).
 */
export async function listBambooHrEmployees(params: {
  secret: CredentialSecret | undefined;
  where: string;
}): Promise<BambooHrEmployee[]> {
  const { secret, where } = params;

  const apiKey = secret?.apiKey;
  const companyDomain = secret?.companyDomain;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new NonRetriableError(
      `${where}: no BambooHR credential is connected.`,
    );
  }
  if (
    typeof companyDomain !== "string" ||
    !COMPANY_DOMAIN.test(companyDomain)
  ) {
    // Checked rather than trusted: the domain is a path segment on a fixed
    // host, and a value carrying "/" or "@" would re-point the URL's
    // authority.
    throw new NonRetriableError(
      `${where}: the BambooHR credential's company domain must be the plain subdomain (letters, digits and hyphens).`,
    );
  }

  // Basic auth with the key as the username; BambooHR ignores the password
  // half and their own documentation sends "x".
  const authorization = `Basic ${Buffer.from(`${apiKey}:x`).toString("base64")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(
      `${serviceEndpoint("bamboohr")}/${companyDomain}/v1/employees/directory`,
      {
        headers: { Authorization: authorization, Accept: "application/json" },
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `${where}: BambooHR did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`,
      );
    }
    // Re-thrown, never swallowed: a poll that returns [] on a network error
    // would look exactly like "nothing new" (rule §1).
    throw new Error(
      `${where}: could not reach BambooHR — ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw classify(response.status, where, response.headers.get("retry-after"));
  }

  const body = (await response.json()) as DirectoryResponse;
  if (!Array.isArray(body.employees)) {
    throw new Error(
      `${where}: BambooHR returned a directory without an employees array.`,
    );
  }

  return body.employees.flatMap((entry): BambooHrEmployee[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const id = row.id;
    // An employee with no id cannot be deduplicated, so dispatching it would
    // re-run it on every poll forever. Drop it rather than loop.
    if (typeof id !== "string" && typeof id !== "number") return [];

    return [
      {
        id: String(id),
        displayName: readString(row, "displayName"),
        firstName: readString(row, "firstName"),
        lastName: readString(row, "lastName"),
        workEmail: readString(row, "workEmail"),
        jobTitle: readString(row, "jobTitle"),
        department: readString(row, "department"),
        supervisorEmail: readString(row, "supervisorEmail"),
        hireDate: readString(row, "hireDate"),
      },
    ];
  });
}
