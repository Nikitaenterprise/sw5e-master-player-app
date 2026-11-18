// What keeps strangers out of the table's server (F-070, docs/БЕЗПЕКА.md).
//
// The server listens on the local network with no passwords: the table is a few friends
// in one room, and a password at five minutes to the session is a cost nobody pays. So
// the guard is about where a request comes from, not who sends it:
//
// - the GM screen opens only on the computer the server runs on (loopback);
// - a request must name the server by an IP address or "localhost" — a web page that
//   points some domain name at this computer (DNS rebinding) is turned away;
// - a browser connecting to the WebSocket must be on a page of this server — so a page
//   on some other site, open in the GM's browser, cannot drive the GM screen.
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/** Whether the connection comes from this very computer. */
export function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false;
  const plain = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return plain === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(plain);
}

/** The host name in a Host header, without the port: "192.168.1.5", "localhost", "::1". */
export function hostName(host: string | undefined): string | null {
  if (host === undefined || host === '') return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(host);
  if (bracketed !== null) return bracketed[1] ?? null;
  const plain = /^([^:]+)(?::\d+)?$/.exec(host);
  return plain?.[1] ?? null;
}

/**
 * Whether the request names this server the way the table does: by IP address, or as
 * localhost. A domain name means someone else's page has pointed its name here.
 */
export function isAllowedHost(host: string | undefined): boolean {
  const name = hostName(host);
  if (name === null) return false;
  return name.toLowerCase() === 'localhost' || isIP(name.replace(/%.*$/, '')) !== 0;
}

/**
 * Whether a browser's WebSocket comes from a page of this server. No Origin at all is a
 * program, not a browser page (the tests, a script on the owner's computer): it is let
 * through here, and the GM role still asks for loopback.
 */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Hashes of the inline scripts of a page, for its Content-Security-Policy. */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    out.push(`'sha256-${createHash('sha256').update(m[1] ?? '', 'utf8').digest('base64')}'`);
  }
  return out;
}

/**
 * Headers every response carries. Scripts only from this server (plus the page's own
 * inline scripts, by hash); connections only back to it; no framing by other sites;
 * no guessing of content types; no address leaking to links out.
 */
export function securityHeaders(host: string | undefined, scriptHashes: string[] = []): Record<string, string> {
  const name = hostName(host);
  const socket = name === null || host === undefined ? '' : ` ws://${host}`;
  return {
    'content-security-policy': [
      "default-src 'self'",
      `script-src 'self'${scriptHashes.map((h) => ` ${h}`).join('')}`,
      // React sets styles through the DOM; the 404 page and the demo carry style blocks.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      `connect-src 'self'${socket}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      // The four-screen demo frames its own pages; nobody else may.
      "frame-ancestors 'self'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
  };
}

/** The biggest message a screen may send. The largest real one — an item with its effects — is a few kilobytes. */
export const MAX_MESSAGE_BYTES = 256 * 1024;
