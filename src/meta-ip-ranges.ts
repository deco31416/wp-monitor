/**
 * Compatibility helpers backed by the versioned infrastructure registry.
 * Classification describes observed network infrastructure, never identity.
 */

import { BlockList, isIP } from 'node:net';
import { lookupInfrastructure } from './network-infrastructure-registry.js';

type IPv4Parts = [number, number, number, number];

function parseIPv4Parts(ip: string): IPv4Parts | null {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return null;
    }
    return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

export function isMetaIP(ip: string): boolean {
    return lookupInfrastructure(ip).provider === 'meta';
}

export function isGoogleSTUN(ip: string): boolean {
    const evidence = lookupInfrastructure(ip);
    return evidence.provider === 'google' && evidence.category === 'stun_turn';
}

export function isCloudflareIP(ip: string): boolean {
    return lookupInfrastructure(ip).provider === 'cloudflare';
}

export function isKnownRelayIP(ip: string): boolean {
    const role = lookupInfrastructure(ip).endpointRole;
    return role === 'relay' || role === 'stun_turn';
}

export function classifyIP(ip: string): 'meta' | 'google' | 'cloudflare' | 'unknown' {
    return lookupInfrastructure(ip).provider;
}

export function isPrivateIP(ip: string): boolean {
    const family = isIP(ip);
    if (family === 6) return privateIpv6Ranges.check(ip, 'ipv6');
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

const privateIpv6Ranges = new BlockList();
privateIpv6Ranges.addSubnet('::', 128, 'ipv6');
privateIpv6Ranges.addSubnet('::1', 128, 'ipv6');
privateIpv6Ranges.addSubnet('fc00::', 7, 'ipv6');
privateIpv6Ranges.addSubnet('fe80::', 10, 'ipv6');
privateIpv6Ranges.addSubnet('ff00::', 8, 'ipv6');
privateIpv6Ranges.addSubnet('2001:db8::', 32, 'ipv6');
