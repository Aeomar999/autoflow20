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
