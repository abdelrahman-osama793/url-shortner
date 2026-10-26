import { isIP } from 'node:net';

// Turns a client IP into the key used for per-network rate limits (technical-design §6).
//   * IPv4: the full address.
//   * IPv6: the /64 network. One subscriber usually controls a whole /64, so limiting single
//     IPv6 addresses would let them use a fresh address for every request.
//   * IPv4-mapped IPv6 (::ffff:1.2.3.4) is treated as the IPv4 address it contains.
// The client IP itself comes from Express's req.ip, which honours TRUST_PROXY_HOPS.

const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

// Expands an IPv6 address into its eight 16-bit groups (embedded IPv4 tails included).
function ipv6Groups(address) {
  let text = address.toLowerCase();

  const dottedTail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);

  if (dottedTail) {
    const [a, b, c, d] = dottedTail[1].split('.').map(Number);
    text = text.slice(0, -dottedTail[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const [head, tail] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;

  const groups = text.includes('::')
    ? [...headGroups, ...Array(missing).fill('0'), ...tailGroups]
    : headGroups;

  return groups.map((group) => group.padStart(4, '0'));
}

// Returns e.g. "ipv4:203.0.113.7" or "ipv6:2001:0db8:0001:0002::/64", or null when the
// address is missing or malformed (callers then fall back to a shared "unknown" key).
export function networkKey(ip) {
  if (!ip) return null;

  const mapped = ip.match(IPV4_MAPPED);
  const address = mapped ? mapped[1] : ip;

  const version = isIP(address);

  if (version === 4) return `ipv4:${address}`;
  if (version === 6) return `ipv6:${ipv6Groups(address).slice(0, 4).join(':')}::/64`;

  return null;
}
