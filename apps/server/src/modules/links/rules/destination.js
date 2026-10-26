import { isIP, BlockList } from 'node:net';

import { DESTINATION_MAX_LENGTH } from '@shortlist/contracts';

// Destination rules (technical-design §4, "Create a link"). The URL is parsed, never fetched.
// These checks stop obvious misuse (internal addresses, credential phishing, redirect loops).
// They are not a malware or DNS-rebinding defence: a public hostname can still resolve to
// a private address, which is why the redirect service never fetches destinations itself.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// C0 controls, DEL and C1 controls. The URL parser silently deletes tabs and newlines,
// so "https://exa\nmple.com" would otherwise be accepted as example.com.
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

// Addresses that are never a legitimate public destination. IPv4 and IPv6 use separate
// lists on purpose: a BlockList also tests IPv4 addresses against its IPv6 rules in mapped
// form, so the ::ffff:0:0/96 rule below would otherwise block every IPv4 address.
const NON_PUBLIC_IPV4 = new BlockList();
const NON_PUBLIC_IPV6 = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (includes cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
]) {
  NON_PUBLIC_IPV4.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::ffff:0:0', 96], // IPv4-mapped: would bypass the IPv4 list
  ['64:ff9b::', 96], // NAT64: embeds IPv4 addresses
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local (private)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
]) {
  NON_PUBLIC_IPV6.addSubnet(network, prefix, 'ipv6');
}

export class InvalidDestinationError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'InvalidDestinationError';
  }
}

function parseUrl(text) {
  try {
    return new URL(text);
  } catch {
    throw new InvalidDestinationError('Enter a complete URL starting with http:// or https://.');
  }
}

// The parser already canonicalises hostnames: lower-case, and IPv4 shorthand or hex
// ("0x7f.1") becomes dotted decimal. Brackets and a trailing dot are removed here.
function bareHostname(url) {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isNonPublicIp(host) {
  const version = isIP(host);

  if (version === 4) return NON_PUBLIC_IPV4.check(host, 'ipv4');
  if (version === 6) return NON_PUBLIC_IPV6.check(host, 'ipv6');

  return false;
}

function isLocalName(host) {
  return host === 'localhost' || host.endsWith('.localhost');
}

// Returns the normalised URL string to store, or throws InvalidDestinationError.
// `ownHosts` are this service's hostnames: linking to them would create redirect loops.
export function validateDestination(rawUrl, { ownHosts }) {
  const text = rawUrl.trim();

  if (text.length === 0) {
    throw new InvalidDestinationError('Enter a URL.');
  }

  if (CONTROL_CHARACTERS.test(text)) {
    throw new InvalidDestinationError('The URL contains invalid characters.');
  }

  const url = parseUrl(text);

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidDestinationError('Only http:// and https:// URLs can be shortened.');
  }

  if (url.username || url.password) {
    throw new InvalidDestinationError('URLs with a username or password cannot be shortened.');
  }

  const host = bareHostname(url);

  if (isLocalName(host) || isNonPublicIp(host)) {
    throw new InvalidDestinationError('Local and private network addresses cannot be shortened.');
  }

  // A single-label name ("intranet") can only resolve inside a private network.
  if (isIP(host) === 0 && !host.includes('.')) {
    throw new InvalidDestinationError('Use a public domain name such as example.com.');
  }

  if (ownHosts.has(host)) {
    throw new InvalidDestinationError('Links to this service cannot be shortened again.');
  }

  const normalised = url.href;

  if (normalised.length > DESTINATION_MAX_LENGTH) {
    throw new InvalidDestinationError(`The URL must be at most ${DESTINATION_MAX_LENGTH} characters.`);
  }

  return normalised;
}
