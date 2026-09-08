export type ObservedPresenceValue = 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';
export type ObservedPresenceScope = 'availability' | 'direct_chat';

export interface ObservedPresenceCounts {
    availabilitySignals: number;
    available: number;
    unavailable: number;
    directChatSignals: number;
    composing: number;
    recording: number;
    paused: number;
}

const OBSERVED_PRESENCE_VALUES = new Set<ObservedPresenceValue>([
    'available',
    'unavailable',
    'composing',
    'recording',
    'paused',
]);

export function normalizeObservedPresence(value: unknown): ObservedPresenceValue | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase() as ObservedPresenceValue;
    return OBSERVED_PRESENCE_VALUES.has(normalized) ? normalized : null;
}

export function classifyObservedPresenceScope(value: unknown): ObservedPresenceScope | null {
    const presence = normalizeObservedPresence(value);
    if (presence === 'available' || presence === 'unavailable') return 'availability';
    if (presence === 'composing' || presence === 'recording' || presence === 'paused') return 'direct_chat';
    return null;
}

export function summarizeObservedPresenceGroups(
    groups: Iterable<{ type: unknown; count: unknown }>,
): ObservedPresenceCounts {
    const summary: ObservedPresenceCounts = {
        availabilitySignals: 0,
        available: 0,
        unavailable: 0,
        directChatSignals: 0,
        composing: 0,
        recording: 0,
        paused: 0,
    };

    for (const group of groups) {
        const presence = normalizeObservedPresence(group.type);
        const count = typeof group.count === 'number' && Number.isFinite(group.count) && group.count > 0
            ? Math.floor(group.count)
            : 0;
        if (!presence || count === 0) continue;
        summary[presence] += count;
        if (classifyObservedPresenceScope(presence) === 'availability') {
            summary.availabilitySignals += count;
        } else {
            summary.directChatSignals += count;
        }
    }

    return summary;
}

export function isActiveObservedPresence(value: unknown): value is 'available' | 'composing' | 'recording' {
    return value === 'available' || value === 'composing' || value === 'recording';
}

export function closesObservedPresence(value: unknown): value is 'unavailable' | 'paused' {
    return value === 'unavailable' || value === 'paused';
}

export function observedPresenceTtlMs(value: ObservedPresenceValue): number {
    if (value === 'available') return 45_000;
    return 12_000;
}

export function formatObservedPresenceLabel(value: ObservedPresenceValue): string {
    switch (value) {
        case 'available': return 'En línea observado';
        case 'composing': return 'Escribiendo observado';
        case 'recording': return 'Grabando audio observado';
        case 'paused': return 'Actividad pausada observada';
        case 'unavailable': return 'Presencia no disponible';
    }
}
