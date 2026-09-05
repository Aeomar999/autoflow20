import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { airtableFetch } from "@/features/airtable/server/airtable-client";
import { githubFetch } from "@/features/github/server/github-client";
import { SERVICE_FIXTURE_ENV } from "@/lib/server/service-endpoints";

/**
 * The seam, proved through real clients (AF-M10-34).
 *
 * `service-endpoints.test.ts` proves the helper returns the right string. That
 * is not the same claim as "a client actually talks to the fixture" — a client
 * that captured its base URL in a module constant at import time would pass
 * the first test and fail this one, which is the specific mistake this design
 * is guarding against.
 *
 * So this opens a real socket and asserts the request arrived, with the path
 * the client built and the headers it set.
 */

interface Received {
  method: string;
  url: string;
  authorization: string;
}

let server: Server;
let received: Received[] = [];
let origin = "";

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    received.push({
      method: req.method ?? "",
      url: req.url ?? "",
      authorization: String(req.headers.authorization ?? ""),
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ records: [], id: 1 }));
  });

  await new Promise<void>((resolve) => {
    // Port 0: an ephemeral port, because this suite starts its own server
    // rather than sharing globalSetup's, and a fixed one would collide.
    server.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("service redirection reaches a local server through a real client", () => {
  it("sends an Airtable call to the fixture, keeping the path the client built", async () => {
    received = [];
    vi.stubEnv(SERVICE_FIXTURE_ENV, origin);

    await airtableFetch(
      { apiKey: "test-key" },
      {
        baseId: "appTEST",
        table: "Incidents",
        where: "redirect test",
      },
    );

    expect(received).toHaveLength(1);
    // The service segment, then exactly the suffix airtableFetch constructs.
    expect(received[0].url).toContain("/airtable/appTEST/Incidents");
    // The credential still travels: a redirect must not quietly drop auth, or
    // a contract test would pass against a fixture it never authenticated to.
    expect(received[0].authorization).toBe("Bearer test-key");

    vi.unstubAllEnvs();
  });

  it("routes two different services to two different segments", async () => {
    received = [];
    vi.stubEnv(SERVICE_FIXTURE_ENV, origin);

    await airtableFetch(
      { apiKey: "k" },
      {
        baseId: "appA",
        table: "T",
        where: "t",
      },
    );
    await githubFetch({ accessToken: "t" }, { path: "/user", where: "t" });

    expect(received.map((r) => r.url.split("/")[1])).toEqual([
      "airtable",
      "github",
    ]);

    vi.unstubAllEnvs();
  });

  it("addresses the real host when the variable is unset", async () => {
    received = [];
    vi.unstubAllEnvs();

    // `fetch` is stubbed rather than allowed to run. Letting this one go out
    // would genuinely resolve and dial api.airtable.com, which is precisely
    // the thing this suite exists to prove does not happen.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"records":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    try {
      await airtableFetch(
        { apiKey: "k" },
        { baseId: "appA", table: "T", where: "t" },
      );

      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
        "https://api.airtable.com/v0/appA/T",
      );
      expect(received).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
