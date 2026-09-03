import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * Local stand-in for the two public services the reference templates call
 * (AF-M9-16).
 *
 * The three M9 templates were chosen precisely because they run against
 * `httpbin.org` and `jsonplaceholder.typicode.com` — no credentials, so they
 * can be executed for real. But "for real against the public internet" makes
 * the acceptance suite flaky and network-dependent, which is the thing
 * AF-M9-02's loopback exception exists to avoid. This server reproduces the
 * two response shapes the templates actually depend on, on 127.0.0.1, so the
 * suite proves the graphs execute without ever leaving the machine.
 *
 * It is deliberately tiny and dependency-free: `node:http` only. A fixture
 * that needed its own framework would be a second thing to keep working.
 */

/**
 * Fixed port rather than an ephemeral one. The server starts in vitest's
 * `globalSetup`, which is a different process from the test workers (`pool:
 * "forks"`), so an OS-assigned port would have to be handed across that
 * boundary. A constant needs no channel and makes a failure ("connection
 * refused on 5599") immediately legible. Override with `FIXTURE_HTTP_PORT` if
 * 5599 is taken.
 */
export const FIXTURE_PORT = Number(process.env.FIXTURE_HTTP_PORT ?? 5599);

/** Base URL the templates' endpoints are rewritten to. Loopback, so no DNS. */
export const FIXTURE_BASE_URL = `http://127.0.0.1:${FIXTURE_PORT}`;

/** How many records `GET /posts` returns — jsonplaceholder returns 100. */
export const FIXTURE_POST_COUNT = 100;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer | string) => {
      raw += chunk;
      // A fixture must not be a memory bomb if a test misbehaves.
      if (raw.length > 5_000_000) {
        reject(new Error("fixture: request body too large"));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

export function createFixtureServer(): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", FIXTURE_BASE_URL);
    const json = (status: number, payload: unknown) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
    };

    try {
      // httpbin.org/post — echoes the parsed JSON body under `json`. W1's
      // "Service A" and both of W2's broadcasts read `…data.json`.
      if (req.method === "POST" && url.pathname === "/post") {
        const raw = await readBody(req);
        let parsed: unknown = null;
        try {
          parsed = raw.length > 0 ? JSON.parse(raw) : null;
        } catch {
          parsed = raw;
        }
        json(200, {
          json: parsed,
          data: raw,
          headers: req.headers,
          url: `${FIXTURE_BASE_URL}${url.pathname}`,
        });
        return;
      }

      // Deterministic failure, for the W2 case that proves a broadcast can
      // fail under `continueOnFail` without taking the response down.
      if (url.pathname === "/fail") {
        json(500, { error: "fixture: deliberate failure" });
        return;
      }

      // jsonplaceholder.typicode.com/posts — 100 fixed records. Fixed, not
      // random: W3 slices the first 10 and the assertions name their ids.
      if (req.method === "GET" && url.pathname === "/posts") {
        const posts = Array.from({ length: FIXTURE_POST_COUNT }, (_, i) => ({
          userId: Math.floor(i / 10) + 1,
          id: i + 1,
          title: `fixture post ${i + 1}`,
          body: `fixture body ${i + 1}`,
        }));
        json(200, posts);
        return;
      }

      json(404, {
        error: `fixture: no route for ${req.method} ${url.pathname}`,
      });
    } catch (error) {
      json(500, { error: (error as Error).message });
    }
  });
}

/** Start the fixture on `FIXTURE_PORT`; resolves once it is accepting. */
export function startFixtureServer(): Promise<{ close: () => Promise<void> }> {
  const server = createFixtureServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(FIXTURE_PORT, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
