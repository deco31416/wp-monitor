import { readFileSync } from 'node:fs';

const CAP_NET_ADMIN_BIT = 12n;
const CAP_NET_RAW_BIT = 13n;

export function hasEffectiveLinuxCapability(procStatus: string, capabilityBit: bigint): boolean {
    const match = procStatus.match(/^CapEff:\s*([0-9a-f]+)$/im);
    if (!match?.[1]) return false;

    try {
        const effectiveCapabilities = BigInt(`0x${match[1]}`);
        return (effectiveCapabilities & (1n << capabilityBit)) !== 0n;
    } catch {
        return false;
    }
}

export function hasPacketCapturePrivileges(
    platform: NodeJS.Platform = process.platform,
    readProcStatus: () => string = () => readFileSync('/proc/self/status', 'utf8'),
): boolean {
    if (platform !== 'linux') return true;

    try {
        return hasEffectiveLinuxCapability(readProcStatus(), CAP_NET_RAW_BIT);
    } catch {
        return false;
    }
}

export function hasDedicatedCapturePrivileges(
    platform: NodeJS.Platform = process.platform,
    readProcStatus: () => string = () => readFileSync('/proc/self/status', 'utf8'),
): boolean {
    if (platform !== 'linux') return true;

    try {
        const status = readProcStatus();
        return hasEffectiveLinuxCapability(status, CAP_NET_RAW_BIT)
            && hasEffectiveLinuxCapability(status, CAP_NET_ADMIN_BIT);
    } catch {
        return false;
    }
}
