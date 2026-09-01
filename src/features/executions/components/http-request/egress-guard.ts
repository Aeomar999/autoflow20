import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NonRetriableError } from "inngest";

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
 */
export const isBlockedIp = (ip: string): boolean => {
  const version = isIP(ip);

  if (version === 4) {
    return isBlockedIpv4(ip);
  }

  if (version === 6) {
    const candidate = ip.toLowerCase();
    // Unwrap IPv4-mapped IPv6 (e.g. ::ffff:192.168.0.1) before checking.
    const mapped = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isBlockedIpv4(mapped[1]);
    }
    const expanded = expandIpv6(candidate);
    if (
      expanded === "0000:0000:0000:0000:0000:0000:0000:0000" || // :: unspecified
      expanded === "0000:0000:0000:0000:0000:0000:0000:0001" // ::1 loopback
    ) {
      return true;
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

const isBlockedIpv4 = (ip: string): boolean => {
  const value = ipv4ToInt(ip);
  if (value < 0) {
    return true; // unparseable — fail closed
  }
  const blockedPrefixes: Array<[number, number]> = [
    [0x00000000, 8], // 0.0.0.0/8 "this network"
    [0x0a000000, 8], // 10/8 private
    [0x7f000000, 8], // 127/8 loopback
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
 * Residual risk (documented): a DNS rebinding or a redirect from the
 * target host can still land on a private IP between check and request.
 */
export const assertSafeEndpoint = async (raw: string): Promise<URL> => {
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

  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new NonRetriableError(
      `HTTP Request node: cannot resolve endpoint host "${url.hostname}"`,
    );
  }

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedIp(address))
  ) {
    throw new NonRetriableError(
      `HTTP Request node: endpoint host "${url.hostname}" resolves to a blocked (private/metadata) address`,
    );
  }

  return url;
};

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
    const response = await globalThis.fetch(request, { redirect: "manual" });

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

    // The guard, on every hop - this is the whole point of the wrapper.
    await assertSafeEndpoint(next.toString());
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
