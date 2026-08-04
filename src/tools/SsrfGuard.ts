/**
 * SsrfGuard — Server-Side Request Forgery (SSRF) protection utilities.
 *
 * Ported from the C# WebFetchToolProvider SSRF guard logic.
 *
 * Provides URL validation that blocks requests to private, loopback,
 * link-local, multicast and otherwise non-public network addresses.
 * DNS resolution is performed for domain hostnames and every resolved
 * IP address is validated before a request is considered safe (defending
 * against DNS rebinding attacks).
 *
 * Uses only Node.js built-in modules (`dns`, `net`).
 */

import * as dns from "node:dns";
import type { LookupAddress } from "node:dns";
import * as net from "node:net";

/** URL schemes permitted for outbound requests. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Validate that a URL points to a public network address.
 *
 * Steps:
 * 1. Parse the URL — it must be absolute.
 * 2. Restrict to the `http` / `https` schemes.
 * 3. Restrict the port to the protocol default, `80` or `443`.
 * 4. Reject `localhost` and any `*.localhost` hostname.
 * 5. If the hostname is an IP literal, validate it directly.
 * 6. Otherwise resolve the hostname via DNS and validate every resolved
 *    IP address.
 *
 * @param url - The absolute URL to validate.
 * @returns The parsed, validated `URL` object.
 * @throws {Error} When the URL is invalid or points to a non-public address.
 */
export async function validatePublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL (must be absolute): ${url}`);
  }

  // Protocol check — only http / https.
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `Unsupported protocol '${parsed.protocol}': only http and https are allowed`,
    );
  }

  // Port check — only the protocol default (empty), 80 or 443.
  const port = parsed.port;
  if (port !== "" && port !== "80" && port !== "443") {
    throw new Error(`Non-standard port is not allowed: ${port}`);
  }

  const hostname = parsed.hostname;
  if (!hostname) {
    throw new Error("URL must contain a hostname");
  }

  // Reject localhost and any *.localhost subdomain.
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`Localhost hostnames are not allowed: ${hostname}`);
  }

  // Strip surrounding brackets for IPv6 literals (e.g. [::1] -> ::1).
  const host = hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(host)) {
    // Hostname is already an IP literal — validate in place.
    validatePublicIpAddress(host);
  } else {
    // Domain name — resolve and validate every returned address.
    let addresses: LookupAddress[];
    try {
      addresses = await dns.promises.lookup(host, { all: true, family: 0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`DNS resolution failed for '${host}': ${msg}`);
    }
    if (addresses.length === 0) {
      throw new Error(`DNS resolution returned no addresses for: ${host}`);
    }
    for (const addr of addresses) {
      validatePublicIpAddress(addr.address);
    }
  }

  return parsed;
}

/**
 * Validate that an IP address (IPv4 or IPv6) is public.
 *
 * Rejects loopback, private, link-local, multicast, reserved and
 * unspecified addresses.
 *
 * @param ip - The IP address string (no surrounding brackets for IPv6).
 * @throws {Error} When the IP is invalid or non-public.
 */
export function validatePublicIpAddress(ip: string): void {
  const family = net.isIP(ip);
  if (family === 4) {
    validatePublicIpv4(ip);
  } else if (family === 6) {
    validatePublicIpv6(ip);
  } else {
    throw new Error(`Invalid IP address: ${ip}`);
  }
}

/**
 * Determine whether an HTTP status code indicates a redirect.
 *
 * @param statusCode - HTTP response status code.
 * @returns `true` for status codes in the range 300-399.
 */
export function isRedirect(statusCode: number): boolean {
  return statusCode >= 300 && statusCode <= 399;
}

// ---------------------------------------------------------------------------
// IPv4 validation
// ---------------------------------------------------------------------------

/**
 * Validate an IPv4 address for public reachability.
 *
 * Rejects: `0.0.0.0/8`, `10.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16`,
 * `172.16.0.0/12`, `192.168.0.0/16` and everything `>= 224.0.0.0`.
 *
 * @throws {Error} for non-public IPv4 addresses.
 */
function validatePublicIpv4(ip: string): void {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  const octets = parts.map((p) => parseInt(p, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  const [a, b] = octets;

  // 0.0.0.0/8 — "this network" / unspecified.
  if (a === 0) {
    throw new Error(`IP address in 0.0.0.0/8 range is not allowed: ${ip}`);
  }
  // 10.0.0.0/8 — private (RFC 1918).
  if (a === 10) {
    throw new Error(`Private IP address (10.0.0.0/8) is not allowed: ${ip}`);
  }
  // 127.0.0.0/8 — loopback.
  if (a === 127) {
    throw new Error(`Loopback IP address (127.0.0.0/8) is not allowed: ${ip}`);
  }
  // 169.254.0.0/16 — link-local.
  if (a === 169 && b === 254) {
    throw new Error(
      `Link-local IP address (169.254.0.0/16) is not allowed: ${ip}`,
    );
  }
  // 172.16.0.0/12 — private (RFC 1918).
  if (a === 172 && b >= 16 && b <= 31) {
    throw new Error(
      `Private IP address (172.16.0.0/12) is not allowed: ${ip}`,
    );
  }
  // 192.168.0.0/16 — private (RFC 1918).
  if (a === 192 && b === 168) {
    throw new Error(
      `Private IP address (192.168.0.0/16) is not allowed: ${ip}`,
    );
  }
  // 224.0.0.0/4 and above — multicast / reserved.
  if (a >= 224) {
    throw new Error(
      `Multicast/reserved IP address (>= 224.0.0.0) is not allowed: ${ip}`,
    );
  }
}

// ---------------------------------------------------------------------------
// IPv6 validation
// ---------------------------------------------------------------------------

/**
 * Validate an IPv6 address for public reachability.
 *
 * Rejects: unspecified (`::`), loopback (`::1`), link-local (`fe80::/10`),
 * site-local (`fec0::/10`), multicast (`ff00::/8`) and unique-local
 * (`fc00::/7`). IPv4-mapped / IPv4-compatible addresses have their embedded
 * IPv4 portion validated with the IPv4 rules.
 *
 * @throws {Error} for non-public IPv6 addresses.
 */
function validatePublicIpv6(ip: string): void {
  const groups = parseIpv6Groups(ip);
  if (!groups) {
    throw new Error(`Invalid IPv6 address: ${ip}`);
  }

  // :: — unspecified.
  if (groups.every((g) => g === 0)) {
    throw new Error(`Unspecified IPv6 address (::) is not allowed: ${ip}`);
  }
  // ::1 — loopback.
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) {
    throw new Error(`Loopback IPv6 address (::1) is not allowed: ${ip}`);
  }

  // IPv4-mapped (::ffff:a.b.c.d) or IPv4-compatible (::a.b.c.d) — validate the
  // embedded IPv4 address with the IPv4 rules.
  const firstFiveZero =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0;
  if (firstFiveZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const a = (groups[6] >> 8) & 0xff;
    const b = groups[6] & 0xff;
    const c = (groups[7] >> 8) & 0xff;
    const d = groups[7] & 0xff;
    validatePublicIpv4(`${a}.${b}.${c}.${d}`);
    return;
  }

  // fe80::/10 — link-local.
  if ((groups[0] & 0xffc0) === 0xfe80) {
    throw new Error(
      `Link-local IPv6 address (fe80::/10) is not allowed: ${ip}`,
    );
  }
  // fec0::/10 — site-local (deprecated).
  if ((groups[0] & 0xffc0) === 0xfec0) {
    throw new Error(
      `Site-local IPv6 address (fec0::/10) is not allowed: ${ip}`,
    );
  }
  // ff00::/8 — multicast.
  if ((groups[0] & 0xff00) === 0xff00) {
    throw new Error(`Multicast IPv6 address (ff00::/8) is not allowed: ${ip}`);
  }
  // fc00::/7 — unique local (private).
  if ((groups[0] & 0xfe00) === 0xfc00) {
    throw new Error(`Private IPv6 address (fc00::/7) is not allowed: ${ip}`);
  }
}

/**
 * Parse an IPv6 address into an array of 8 16-bit groups.
 *
 * Handles `::` zero-compression and embedded IPv4 suffixes
 * (e.g. `::ffff:192.168.1.1`). Returns `null` for malformed input.
 *
 * @param ip - A candidate IPv6 address string (validated by `net.isIPv6`).
 * @returns Array of 8 numeric groups, or `null`.
 */
function parseIpv6Groups(ip: string): number[] | null {
  if (!net.isIPv6(ip)) return null;

  let work = ip;

  // Replace an embedded IPv4 suffix (last 32 bits) with two hex groups so the
  // remainder can be parsed as a pure colon-separated hex address.
  const v4Match = work.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Match) {
    const octets = v4Match[1].split(".").map((s) => parseInt(s, 10));
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
      return null;
    }
    const g1 = ((octets[0] << 8) | octets[1]).toString(16);
    const g2 = ((octets[2] << 8) | octets[3]).toString(16);
    work = work.slice(0, work.length - v4Match[1].length) + g1 + ":" + g2;
  }

  const result: number[] = [];
  let left: string[];
  let right: string[];

  if (work.includes("::")) {
    const segments = work.split("::");
    if (segments.length !== 2) return null; // at most one "::" is allowed
    left = segments[0] ? segments[0].split(":") : [];
    right = segments[1] ? segments[1].split(":") : [];
  } else {
    left = work ? work.split(":") : [];
    right = [];
  }

  const leftGroups = left.map((g) => parseInt(g, 16));
  const rightGroups = right.map((g) => parseInt(g, 16));
  if (leftGroups.some((g) => Number.isNaN(g)) || rightGroups.some((g) => Number.isNaN(g))) {
    return null;
  }

  if (work.includes("::")) {
    const zeros = 8 - (leftGroups.length + rightGroups.length);
    if (zeros < 1) return null; // "::" must compress at least one group
    result.push(...leftGroups, ...new Array<number>(zeros).fill(0), ...rightGroups);
  } else {
    if (leftGroups.length !== 8) return null;
    result.push(...leftGroups);
  }

  if (result.length !== 8) return null;
  if (result.some((g) => g < 0 || g > 0xffff)) return null;
  return result;
}
