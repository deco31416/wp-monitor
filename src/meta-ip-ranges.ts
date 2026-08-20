/**
 * Meta / Facebook IP Ranges
 *
 * Known IPv4 prefixes for Meta Platforms (AS32934, AS63293).
 * Used to classify relay/TURN server IPs during call analysis.
 *
 * Sources:
 *   - https://bgp.he.net/AS32934#_prefixes
 *   - https://developers.facebook.com/docs/sharing/webmasters/crawler
 *   - https://whois.arin.net (AS32934)
 *
 * For educational and research purposes only.
 */

// ── Meta / Facebook IPv4 CIDR prefixes (AS32934 + AS63293) ─────────

const META_CIDRS: string[] = [
    // AS32934 — Facebook / Meta primary
    '31.13.24.0/21',
    '31.13.64.0/18',
    '45.64.40.0/22',
    '57.141.0.0/16',
    '57.142.0.0/15',
    '57.144.0.0/14',
    '57.148.0.0/15',
    '66.220.144.0/20',
    '66.220.152.0/21',
    '69.63.176.0/20',
    '69.171.224.0/19',
    '69.171.224.0/20',
    '69.171.240.0/20',
    '74.119.76.0/22',
    '102.132.96.0/20',
    '103.4.96.0/22',
    '129.134.0.0/17',
    '147.75.208.0/20',
    '157.240.0.0/17',
    '157.240.0.0/24',
    '157.240.1.0/24',
    '157.240.2.0/24',
    '157.240.3.0/24',
    '157.240.7.0/24',
    '157.240.8.0/24',
    '157.240.9.0/24',
    '157.240.10.0/24',
    '157.240.11.0/24',
    '157.240.12.0/24',
    '157.240.13.0/24',
    '157.240.14.0/24',
    '157.240.15.0/24',
    '157.240.16.0/24',
    '157.240.17.0/24',
    '157.240.18.0/24',
    '157.240.19.0/24',
    '157.240.20.0/24',
    '157.240.21.0/24',
    '157.240.22.0/24',
    '157.240.23.0/24',
    '157.240.24.0/24',
    '157.240.25.0/24',
    '157.240.26.0/24',
    '157.240.27.0/24',
    '157.240.28.0/24',
    '157.240.29.0/24',
    '157.240.30.0/24',
    '157.240.31.0/24',
    '163.70.128.0/17',
    '179.60.192.0/22',
    '185.60.216.0/22',
    '185.89.218.0/23',
    '204.15.20.0/22',

    // AS63293 — Facebook edge / CDN
    '173.252.64.0/18',
    '173.252.88.0/21',
    '173.252.96.0/19',

    // WhatsApp-specific (observed in call traffic)
    '158.85.0.0/16',
    '158.85.224.0/21',
    '50.22.198.0/24',
    '169.44.0.0/16',
    '174.37.0.0/16',

    // Meta TURN/relay servers (commonly seen in VoIP)
    '185.60.216.0/24',
    '185.60.217.0/24',
    '185.60.218.0/24',
    '185.60.219.0/24',
];

// ── Google STUN/TURN server ranges ─────────────────────────────────
const GOOGLE_STUN_CIDRS: string[] = [
    '142.250.0.0/15',
    '172.217.0.0/16',
    '216.58.192.0/19',
    '216.239.32.0/19',
    '74.125.0.0/16',
    '64.233.160.0/19',
    '108.177.0.0/17',
];

// ── Cloudflare ranges (sometimes used as TURN relay) ───────────────
const CLOUDFLARE_CIDRS: string[] = [
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
    '141.101.64.0/18',
    '162.158.0.0/15',
    '188.114.96.0/20',
    '190.93.240.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
];

// ── CIDR parsing utilities ─────────────────────────────────────────

interface ParsedCIDR {
    networkInt: number;
    maskInt: number;
}

type IPv4Parts = [number, number, number, number];

function parseIPv4Parts(ip: string): IPv4Parts | null {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return null;
    }
    return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

/**
 * Parse a CIDR string (e.g. "192.168.1.0/24") into network and mask integers
 */
function parseCIDR(cidr: string): ParsedCIDR {
    const [ip, prefixStr] = cidr.split('/');
    const prefix = Number(prefixStr);
    const parts = ip ? parseIPv4Parts(ip) : null;
    if (!parts || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        throw new Error(`Invalid internal CIDR range: ${cidr}`);
    }
    const [a, b, c, d] = parts;
    const ipInt = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
    const maskInt = prefix === 0 ? 0 : ((0xFFFFFFFF << (32 - prefix)) >>> 0);
    return {
        networkInt: (ipInt & maskInt) >>> 0,
        maskInt,
    };
}

/**
 * Convert an IPv4 address string to a 32-bit unsigned integer
 */
function ipToInt(ip: string): number | null {
    const parts = parseIPv4Parts(ip);
    if (!parts) return null;
    const [a, b, c, d] = parts;
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

// Pre-parse all CIDR ranges for fast lookup
const metaParsed: ParsedCIDR[] = META_CIDRS.map(parseCIDR);
const googleParsed: ParsedCIDR[] = GOOGLE_STUN_CIDRS.map(parseCIDR);
const cloudflareParsed: ParsedCIDR[] = CLOUDFLARE_CIDRS.map(parseCIDR);

function matchesCIDRList(ip: string, parsed: ParsedCIDR[]): boolean {
    const ipInt = ipToInt(ip);
    if (ipInt === null) return false;
    for (const { networkInt, maskInt } of parsed) {
        if (((ipInt & maskInt) >>> 0) === networkInt) return true;
    }
    return false;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Check if an IP belongs to Meta/Facebook/WhatsApp infrastructure
 */
export function isMetaIP(ip: string): boolean {
    return matchesCIDRList(ip, metaParsed);
}

/**
 * Check if an IP belongs to Google STUN/TURN servers
 */
export function isGoogleSTUN(ip: string): boolean {
    return matchesCIDRList(ip, googleParsed);
}

/**
 * Check if an IP belongs to Cloudflare
 */
export function isCloudflareIP(ip: string): boolean {
    return matchesCIDRList(ip, cloudflareParsed);
}

/**
 * Check if an IP belongs to any known relay/infrastructure provider
 */
export function isKnownRelayIP(ip: string): boolean {
    return isMetaIP(ip) || isGoogleSTUN(ip) || isCloudflareIP(ip);
}

/**
 * Classify an IP into a provider category
 */
export function classifyIP(ip: string): 'meta' | 'google' | 'cloudflare' | 'unknown' {
    if (isMetaIP(ip)) return 'meta';
    if (isGoogleSTUN(ip)) return 'google';
    if (isCloudflareIP(ip)) return 'cloudflare';
    return 'unknown';
}

/**
 * Check if an IP is a private/local address
 */
export function isPrivateIP(ip: string): boolean {
    const parts = parseIPv4Parts(ip);
    if (!parts) return true;
    const [a, b, c] = parts;
    const isPrivate172 = a === 172 && b >= 16 && b <= 31;
    const isCarrierNat = a === 100 && b >= 64 && b <= 127;
    const isBenchmark = a === 198 && (b === 18 || b === 19);
    const isDocumentation =
        (a === 192 && b === 0 && c === 2) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113);
    const isMulticastOrReserved = a >= 224;
    return (
        ip.startsWith('10.') ||
        isCarrierNat ||
        isPrivate172 ||
        ip.startsWith('192.168.') ||
        ip.startsWith('127.') ||
        ip === '0.0.0.0' ||
        ip === '255.255.255.255' ||
        isMulticastOrReserved ||
        isBenchmark ||
        isDocumentation ||
        ip.startsWith('169.254.')
    );
}
