const PROBE_ID_TTL_MS = 60_000;
const MAX_TRACKED_PROBE_IDS = 5_000;

const syntheticProbeIds = new Map<string, number>();

function cleanProbeId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    return id ? id : null;
}

function pruneSyntheticProbeIds(now: number): void {
    for (const [id, expiresAt] of syntheticProbeIds) {
        if (expiresAt <= now) syntheticProbeIds.delete(id);
    }

    while (syntheticProbeIds.size > MAX_TRACKED_PROBE_IDS) {
        const oldest = syntheticProbeIds.keys().next().value;
        if (typeof oldest !== 'string') break;
        syntheticProbeIds.delete(oldest);
    }
}

export function registerSyntheticProbeId(value: unknown, now: number = Date.now()): void {
    const id = cleanProbeId(value);
    if (!id) return;
    pruneSyntheticProbeIds(now);
    syntheticProbeIds.set(id, now + PROBE_ID_TTL_MS);
}

function isRegisteredProbeId(value: unknown, now: number): boolean {
    const id = cleanProbeId(value);
    if (!id) return false;
    const expiresAt = syntheticProbeIds.get(id);
    if (!expiresAt) return false;
    if (expiresAt <= now) {
        syntheticProbeIds.delete(id);
        return false;
    }
    return true;
}

export function isSyntheticProbeMessage(message: any, now: number = Date.now()): boolean {
    pruneSyntheticProbeIds(now);
    const payload = message?.message;
    return isRegisteredProbeId(message?.key?.id, now)
        || isRegisteredProbeId(payload?.reactionMessage?.key?.id, now)
        || isRegisteredProbeId(payload?.protocolMessage?.key?.id, now);
}
