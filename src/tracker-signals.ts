export const NO_ACK_STATE = 'NO_ACK';
export const LEGACY_OFFLINE_STATE = 'OFFLINE';
export const ONLINE_STATE = 'Online';
export const STANDBY_STATE = 'Standby';
export const CALIBRATING_STATE = 'Calibrating...';
export const UNKNOWN_STATE = 'Unknown';
export const ONLINE_TRACKER_STATE_REGEX = /^online/i;
export const CONCLUSIVE_TRACKER_STATE_REGEX = /^(online|standby)/i;

export const TRACKER_STATE_CATEGORY = {
    ONLINE: 'ONLINE',
    STANDBY: 'STANDBY',
    CALIBRATING: 'CALIBRATING',
    NO_ACK: 'NO_ACK',
    UNKNOWN: 'UNKNOWN',
} as const;

export type TrackerStateCategory = typeof TRACKER_STATE_CATEGORY[keyof typeof TRACKER_STATE_CATEGORY];
export type TrackerProbeState = typeof ONLINE_STATE
    | typeof STANDBY_STATE
    | typeof CALIBRATING_STATE
    | typeof NO_ACK_STATE;
export type TrackerConnectionType = 'wifi' | 'cellular' | 'unknown';

export interface TrackerDeviceUpdate {
    jid: string;
    state: TrackerProbeState;
    rtt: number;
    avg: number;
}

export interface TrackerUpdate {
    sampleKind: 'initial' | 'probe';
    devices: TrackerDeviceUpdate[];
    deviceCount: number;
    presence: string | null;
    connectionType: TrackerConnectionType | null;
    median: number;
    threshold: number;
}

export interface TrackerStateCounts {
    online: number;
    standby: number;
    calibrating: number;
    noAck: number;
    unknown: number;
    total: number;
}

export interface PresenceSignalLike {
    lastKnownPresence?: string | null;
    [key: string]: unknown;
}

export interface PresenceUpdateLike {
    id?: unknown;
    presences?: Record<string, PresenceSignalLike | null | undefined>;
}

export type PresenceSignalWithValue = PresenceSignalLike & { lastKnownPresence: string };

export interface TrackerUpdateLike {
    sampleKind?: 'initial' | 'probe';
    devices?: unknown;
    median?: unknown;
}

/**
 * Normalize a WhatsApp JID for ownership comparisons while preserving its
 * namespace. Device JIDs such as `number:device@s.whatsapp.net` resolve to the
 * same account JID; LIDs remain in the `@lid` namespace until explicitly known.
 */
export function normalizeComparableJid(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const jid = value.trim();
    const separator = jid.lastIndexOf('@');
    if (separator <= 0 || separator === jid.length - 1) return null;

    const user = (jid.slice(0, separator).split(':')[0] ?? '').trim();
    const server = jid.slice(separator + 1).trim().toLowerCase();
    if (!user || !server) return null;
    return `${user}@${server}`;
}

export function isTechnicalLidJid(value: unknown): boolean {
    return normalizeComparableJid(value)?.endsWith('@lid') === true;
}

export function isNoAckState(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toUpperCase();
    return normalized === NO_ACK_STATE || normalized === LEGACY_OFFLINE_STATE;
}

/**
 * Map current and historical raw tracker values into stable reporting buckets.
 * Unknown values remain explicit instead of being silently counted as Standby.
 */
export function classifyTrackerState(value: unknown): TrackerStateCategory {
    if (isNoAckState(value)) return TRACKER_STATE_CATEGORY.NO_ACK;
    if (typeof value !== 'string') return TRACKER_STATE_CATEGORY.UNKNOWN;

    const normalized = value.trim().toUpperCase();
    if (normalized.startsWith('ONLINE')) return TRACKER_STATE_CATEGORY.ONLINE;
    if (normalized === STANDBY_STATE.toUpperCase()) return TRACKER_STATE_CATEGORY.STANDBY;
    if (normalized.startsWith('CALIBRATING')) return TRACKER_STATE_CATEGORY.CALIBRATING;
    return TRACKER_STATE_CATEGORY.UNKNOWN;
}

export function isOnlineTrackerState(value: unknown): boolean {
    return classifyTrackerState(value) === TRACKER_STATE_CATEGORY.ONLINE;
}

export function isConclusiveTrackerState(value: unknown): boolean {
    const category = classifyTrackerState(value);
    return category === TRACKER_STATE_CATEGORY.ONLINE || category === TRACKER_STATE_CATEGORY.STANDBY;
}

export function hasAcknowledgedTrackerRtt(value: unknown): boolean {
    const category = classifyTrackerState(value);
    return category === TRACKER_STATE_CATEGORY.ONLINE
        || category === TRACKER_STATE_CATEGORY.STANDBY
        || category === TRACKER_STATE_CATEGORY.CALIBRATING;
}

export function selectPrimaryTrackerDevice<T extends { state: unknown }>(devices: readonly T[]): T | undefined {
    const priorities: TrackerStateCategory[] = [
        TRACKER_STATE_CATEGORY.ONLINE,
        TRACKER_STATE_CATEGORY.STANDBY,
        TRACKER_STATE_CATEGORY.CALIBRATING,
        TRACKER_STATE_CATEGORY.NO_ACK,
        TRACKER_STATE_CATEGORY.UNKNOWN,
    ];

    for (const category of priorities) {
        const selected = devices.find(device => classifyTrackerState(device.state) === category);
        if (selected) return selected;
    }
    return undefined;
}

export function summarizeTrackerStates(values: Iterable<unknown>): TrackerStateCounts {
    const counts: TrackerStateCounts = {
        online: 0,
        standby: 0,
        calibrating: 0,
        noAck: 0,
        unknown: 0,
        total: 0,
    };

    for (const value of values) {
        counts.total += 1;
        switch (classifyTrackerState(value)) {
            case TRACKER_STATE_CATEGORY.ONLINE:
                counts.online += 1;
                break;
            case TRACKER_STATE_CATEGORY.STANDBY:
                counts.standby += 1;
                break;
            case TRACKER_STATE_CATEGORY.CALIBRATING:
                counts.calibrating += 1;
                break;
            case TRACKER_STATE_CATEGORY.NO_ACK:
                counts.noAck += 1;
                break;
            case TRACKER_STATE_CATEGORY.UNKNOWN:
                counts.unknown += 1;
                break;
        }
    }

    return counts;
}

export function jidBelongsToTarget(
    candidate: unknown,
    targetJid: string,
    trackedJids: Iterable<string> = [],
): boolean {
    const normalizedCandidate = normalizeComparableJid(candidate);
    if (!normalizedCandidate) return false;

    const allowed = new Set<string>();
    const normalizedTarget = normalizeComparableJid(targetJid);
    if (normalizedTarget) allowed.add(normalizedTarget);
    for (const trackedJid of trackedJids) {
        const normalized = normalizeComparableJid(trackedJid);
        if (normalized) allowed.add(normalized);
    }

    return allowed.has(normalizedCandidate);
}

/**
 * Return only presence entries attributable to this tracker. `update.id` is
 * authoritative when available. A technical LID is accepted only inside an
 * already-scoped event or after it has previously been learned by this tracker.
 */
export function getScopedPresenceEntries(
    update: PresenceUpdateLike,
    targetJid: string,
    trackedJids: Iterable<string> = [],
): Array<[string, PresenceSignalWithValue]> {
    if (!update || typeof update !== 'object' || !update.presences) return [];

    const knownJids = Array.from(trackedJids);
    const eventHasId = normalizeComparableJid(update.id) !== null;
    const eventBelongsToTarget = eventHasId
        ? jidBelongsToTarget(update.id, targetJid, knownJids)
        : false;

    if (eventHasId && !eventBelongsToTarget) return [];

    return Object.entries(update.presences).filter(
        (entry): entry is [string, PresenceSignalWithValue] => {
            const [participantJid, presence] = entry;
            if (!presence?.lastKnownPresence) return false;
            if (jidBelongsToTarget(participantJid, targetJid, knownJids)) return true;
            return eventBelongsToTarget && isTechnicalLidJid(participantJid);
        },
    );
}

export function shouldPersistTrackerMeasurement(update: TrackerUpdateLike): boolean {
    if (update.sampleKind === 'initial') return false;
    if (!Array.isArray(update.devices) || update.devices.length === 0) return false;
    if (!update.devices.every(device => (
        device !== null
        && typeof device === 'object'
        && typeof (device as { state?: unknown }).state === 'string'
    ))) return false;
    return typeof update.median === 'number' && Number.isFinite(update.median);
}
