import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NonRetriableError } from "inngest";
import { Agent } from "undici";
import { allowLoopbackEgress } from "@/lib/env";

/** Default outbound request timeout (AF-A-02). */
export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
/** Hard ceiling for user-configured timeouts. */
export const MAX_HTTP_TIMEOUT_MS = 60_000;
/** Response body cap — larger payloads abort instead of OOM-ing the worker. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const MIN_HTTP_TIMEOUT_MS = 250;

/**
 * True when `ip` must not be reachable from workflow HTTP nodes:
 * loopback, private, link-local (incl. cloud metadata), unspecified,
 * CGNAT, and their IPv6 equivalents / IPv4-mapped forms.
 *
 * `opts.allowLoopback` (AF-M9-02) widens ONLY loopback (`127/8`, `::1`) for
 * the test-only `ALLOW_LOOPBACK_EGRESS` flag. Every other blocked range —
 * private, link-local/metadata, CGNAT, unique-local IPv6 — stays blocked.
 */
export const isBlockedIp = (
  ip: string,
  opts: { allowLoopback?: boolean } = {},
): boolean => {
  const version = isIP(ip);

  if (version === 4) {
    return isBlockedIpv4(ip, opts);
  }

  if (version === 6) {
    const candidate = ip.toLowerCase();
    // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:192.168.0.1) before checking.
    const mapped = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isBlockedIpv4(mapped[1], opts);
    }
    const expanded = expandIpv6(candidate);
    if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") {
      return true; // :: unspecified — always blocked
    }
    if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") {
      // ::1 loopback — allowed only under the test-only loopback flag.
      return !opts.allowLoopback;
    }
    // Unique local fc00::/7 and link-local fe80::/10.
    return /^f[cd]/.test(candidate) || /^fe[89ab]/.test(candidate);
  }

  // Not parseable as an IP — fail closed.
  return true;
};

const ipv4ToInt = (ip: string): number => {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (
    parts.length !== 4 ||
    parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)
  ) {
    return -1;
  }
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
};

const isBlockedIpv4 = (
  ip: string,
  opts: { allowLoopback?: boolean },
): boolean => {
  const value = ipv4ToInt(ip);
  if (value < 0) {
    return true; // unparseable — fail closed
  }
  // 127/8 loopback — allowed only under the test-only loopback flag.
  if ((value & 0xff000000) === 0x7f000000) {
    return !opts.allowLoopback;
  }
  const blockedPrefixes: Array<[number, number]> = [
    [0x00000000, 8], // 0.0.0.0/8 "this network"
    [0x0a000000, 8], // 10/8 private
    [0xa9fe0000, 16], // 169.254/16 link-local (incl. 169.254.169.254 metadata)
    [0xac100000, 12], // 172.16/12 private
    [0xc0a80000, 16], // 192.168/16 private
    [0x64400000, 10], // 100.64/10 CGNAT (Tailscale & friends)
  ];
  return blockedPrefixes.some(([prefix, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (prefix & mask);
  });
};

/** Expand an IPv6 address to 8 colon-separated 4-hex-digit groups. */
export const expandIpv6 = (addr: string): string => {
  let head = addr;
  let tail = "";
  if (addr.includes("::")) {
    [head, tail] = addr.split("::");
  }
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = [
    ...headGroups,
    ...Array.from({ length: Math.max(missing, 0) }, () => "0"),
    ...tailGroups,
  ];
  return groups.map((g) => g.padStart(4, "0")).join(":");
};

/**
 * Validate an endpoint URL before any request leaves the worker:
 * http(s) only, no embedded credentials, and every address the hostname
 * resolves to must be publicly routable. Throws NonRetriableError otherwise.
 *
 * Returns the vetted addresses alongside the URL so the caller can connect to
 * one of *those* rather than resolving the hostname a second time - see
 * `pinnedDispatcher` and ADR-0017. Redirect hops are handled by `safeFetch`.
 */
export const resolveSafeEndpoint = async (
  raw: string,
): Promise<{ url: URL; addresses: LookupAddress[] }> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NonRetriableError(
      `HTTP Request node: invalid endpoint URL "${raw}"`,
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new NonRetriableError(
      `HTTP Request node: endpoint scheme must be http(s), got "${url.protocol}"`,
    );
  }

  if (url.username || url.password) {
    throw new NonRetriableError(
      "HTTP Request node: endpoint must not embed credentials",
    );
  }

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new NonRetriableError(
      `HTTP Request node: cannot resolve endpoint host "${url.hostname}"`,
    );
  }

  // AF-M9-02: the test-only loopback flag widens exactly loopback. Reading it
  // here (per call) costs nothing and lets a test run a loopback target server.
  const allowLoopback = allowLoopbackEgress();

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedIp(address, { allowLoopback }))
  ) {
    throw new NonRetriableError(
      `HTTP Request node: endpoint host "${url.hostname}" resolves to a blocked (private/metadata) address`,
    );
  }

  return { url, addresses };
};

/**
 * Validate an endpoint and return just the URL.
 *
 * The shape every node call site uses. `safeFetch` uses
 * `resolveSafeEndpoint` instead, because it needs the vetted addresses in
 * order to pin the connection to them.
 */
export const assertSafeEndpoint = async (raw: string): Promise<URL> =>
  (await resolveSafeEndpoint(raw)).url;

/**
 * A dispatcher that connects only to addresses we already vetted (AF-M8-17).
 *
 * `resolveSafeEndpoint` resolves a hostname and checks every address it maps
 * to. Handing the *hostname* to `fetch` then throws that work away: fetch
 * resolves it again, and a record whose TTL expired in between can answer
 * differently the second time. That is DNS rebinding - the guard says
 * "93.184.216.34, public, fine" and the socket opens to 127.0.0.1.
 *
 * undici lets the connector's DNS lookup be replaced, so this returns the
 * addresses that were actually vetted instead of asking a resolver again.
 * Everything else about the connection is untouched: the TLS SNI and the
 * `Host` header still carry the hostname, so certificate validation and
 * virtual hosting work exactly as before - which is why this is a `lookup`
 * override rather than rewriting the URL to an IP.
 *
 * The lookup also refuses a hostname it was not built for. A dispatcher is
 * per-request, so being asked about a different host means a redirect got this
 * far without being re-vetted, and failing closed is the only safe answer.
 */
export const pinnedDispatcher = (
  hostname: string,
  addresses: LookupAddress[],
): Agent =>
  new Agent({
    connect: {
      lookup(host, _options, callback) {
        if (host !== hostname) {
          callback(
            new Error(
              `egress guard: refusing to connect to un-vetted host "${host}"`,
            ),
            [],
          );
          return;
        }
        callback(null, addresses);
      },
    },
  });

/** Hops allowed in a single redirect chain before the request is abandoned. */
export const MAX_REDIRECT_HOPS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Headers that authenticate the caller and must not follow a redirect to a
 * different origin - otherwise a redirect turns any node that sends a
 * credential into a way to harvest it.
 */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

const buildRedirectRequest = (
  previous: Request,
  next: URL,
  status: number,
): Request => {
  // Per the fetch spec: 303 always becomes GET, and 301/302 become GET when
  // the original was a POST. 307/308 preserve the method and body.
  const downgradeToGet =
    status === 303 ||
    (previous.method === "POST" && status !== 307 && status !== 308);

  const headers = new Headers(previous.headers);
  if (new URL(previous.url).origin !== next.origin) {
    for (const header of CREDENTIAL_HEADERS) {
      headers.delete(header);
    }
  }

  if (downgradeToGet) {
    return new Request(next, {
      method: "GET",
      headers,
      redirect: "manual",
    });
  }

  return new Request(next, {
    method: previous.method,
    headers,
    body: previous.body,
    // Node requires this when a stream body is reused.
    duplex: "half",
    redirect: "manual",
  } as RequestInit);
};

/**
 * A `fetch` that runs `assertSafeEndpoint` on every redirect hop.
 *
 * AF-M8-16: `assertSafeEndpoint` validates one url. Handing that url to a
 * client that follows redirects itself leaves the guard checking only the
 * first hop, so a user-supplied endpoint pointing at a host the attacker
 * controls could answer `302 Location: http://169.254.169.254/...` and reach
 * cloud metadata - the exact target the IP blocklist exists to deny.
 * `docs/architecture/security.md` §5 already required the re-check; nothing
 * implemented it.
 *
 * Pass this to `ky` as its `fetch` option rather than calling it directly:
 * ky then keeps its own timeout, retry, and `throwHttpErrors` semantics, and
 * every hop is validated in one place instead of at each call site (ADR-0015).
 */
export const safeFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  let request = new Request(input, init);

  for (let hop = 0; ; hop += 1) {
    // Resolve and vet HERE, then connect to exactly what was vetted. Doing the
    // resolution inside this loop is the point: a check performed anywhere
    // else is a check the connection can drift away from (AF-M8-17).
    const { url, addresses } = await resolveSafeEndpoint(request.url);
    const dispatcher = pinnedDispatcher(url.hostname, addresses);

    // `dispatcher` is undici's, not part of the standard RequestInit.
    const response = await globalThis.fetch(request, {
      redirect: "manual",
      dispatcher,
    } as RequestInit & { dispatcher: Agent });

    // Graceful: undici lets enqueued requests - including the streaming body
    // of the response just returned - finish before the sockets go. Not
    // awaited, because the caller has yet to read that body.
    void dispatcher.close().catch(() => {
      // A dispatcher failing to close is a socket-lifecycle detail, not
      // something the caller's request outcome should depend on.
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      // A redirect status with nothing to redirect to is just a response.
      return response;
    }

    if (hop >= MAX_REDIRECT_HOPS) {
      throw new NonRetriableError(
        `HTTP Request node: exceeded ${MAX_REDIRECT_HOPS} redirects from "${request.url}"`,
      );
    }

    let next: URL;
    try {
      next = new URL(location, request.url);
    } catch {
      throw new NonRetriableError(
        `HTTP Request node: redirect to invalid location "${location}"`,
      );
    }

    // Vetted at the top of the next iteration, which both re-runs the guard
    // and pins the connection to what it just approved.
    request = buildRedirectRequest(request, next, response.status);
  }
};

export const resolveTimeoutMs = (input?: number): number => {
  if (typeof input !== "number" || Number.isNaN(input) || input <= 0) {
    return DEFAULT_HTTP_TIMEOUT_MS;
  }
  return Math.min(Math.max(input, MIN_HTTP_TIMEOUT_MS), MAX_HTTP_TIMEOUT_MS);
};

/**
 * Read a response body as text while enforcing the byte cap.
 * Aborts (destroying the connection) once the cap would be exceeded.
 */
export const readCappedText = async (
  response: Response,
  capBytes = MAX_RESPONSE_BYTES,
): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const decoder = new TextDecoder();
  let received = 0;
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > capBytes) {
      void reader.cancel();
      throw new Error(
        `HTTP Request node: response exceeded ${capBytes} byte limit`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
};
