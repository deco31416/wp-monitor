export const COMMERCIAL_CALL_STATUSES = [
    'offer',
    'ringing',
    'accept',
    'busy',
    'reject',
    'timeout',
    'terminate',
] as const;

export type CommercialCallStatus = typeof COMMERCIAL_CALL_STATUSES[number];
export type CommercialCallOutcome =
    | 'incoming'
    | 'ringing'
    | 'active'
    | 'completed'
    | 'busy'
    | 'rejected'
    | 'missed'
    | 'ended_unconfirmed';

export interface RawCallActivitySignal {
    type: string;
    confidence: 'none' | 'low' | 'medium' | 'high';
    timestamp: Date | string;
    timestampUtc: string;
    details?: Record<string, unknown>;
}

export interface CommercialCallMetadata {
    outcome: CommercialCallOutcome;
    direction: 'incoming' | 'outgoing' | 'unknown';
    evidence: 'protocol_confirmed' | 'protocol_observed';
    signalCount: number;
    technicalSignalCount: number;
    startedAt: string;
    endedAt: string | null;
    durationSec: number | null;
    relayLatencyMs: number | null;
    isVideo: boolean;
}

export interface CommercialCallActivityEvent {
    source: 'call';
    type: `call_${CommercialCallOutcome}`;
    label: string;
    confidence: 'medium' | 'high';
    timestamp: Date | string;
    timestampUtc: string;
    call: CommercialCallMetadata;
}

const TERMINAL_STATUSES = new Set(['reject', 'timeout', 'terminate']);

function signalTime(signal: RawCallActivitySignal): number {
    const value = new Date(signal.timestamp).getTime();
    return Number.isFinite(value) ? value : 0;
}

function hasStatus(statuses: Set<string>, status: CommercialCallStatus): boolean {
    return statuses.has(status);
}

export function isCommercialCallStatus(value: string): value is CommercialCallStatus {
    return (COMMERCIAL_CALL_STATUSES as readonly string[]).includes(value);
}

export function buildCommercialCallActivity(
    rawSignals: RawCallActivitySignal[],
): CommercialCallActivityEvent | null {
    if (rawSignals.length === 0) return null;

    const ordered = [...rawSignals].sort((left, right) => signalTime(left) - signalTime(right));
    const statuses = new Set(ordered.map(signal => signal.type));
    if (!ordered.some(signal => isCommercialCallStatus(signal.type))) return null;

    let outcome: CommercialCallOutcome;
    let label: string;
    let confidence: 'medium' | 'high';
    let evidence: CommercialCallMetadata['evidence'];

    if (hasStatus(statuses, 'reject')) {
        outcome = 'rejected';
        label = 'Llamada rechazada';
        confidence = 'high';
        evidence = 'protocol_confirmed';
    } else if (hasStatus(statuses, 'timeout')) {
        outcome = 'missed';
        label = 'Llamada perdida';
        confidence = 'high';
        evidence = 'protocol_confirmed';
    } else if (hasStatus(statuses, 'accept') && hasStatus(statuses, 'terminate')) {
        outcome = 'completed';
        label = 'Llamada contestada y finalizada';
        confidence = 'high';
        evidence = 'protocol_confirmed';
    } else if (hasStatus(statuses, 'accept')) {
        outcome = 'active';
        label = 'Llamada contestada';
        confidence = 'high';
        evidence = 'protocol_confirmed';
    } else if (hasStatus(statuses, 'busy')) {
        outcome = 'busy';
        label = 'Línea ocupada';
        confidence = 'high';
        evidence = 'protocol_confirmed';
    } else if (hasStatus(statuses, 'terminate')) {
        outcome = 'ended_unconfirmed';
        label = 'Llamada finalizada · respuesta no confirmada';
        confidence = 'medium';
        evidence = 'protocol_observed';
    } else if (hasStatus(statuses, 'offer')) {
        outcome = 'incoming';
        label = 'Llamada entrante';
        confidence = 'high';
        evidence = 'protocol_confirmed';
    } else {
        outcome = 'ringing';
        label = 'Llamando';
        confidence = 'high';
        evidence = 'protocol_confirmed';
    }

    const firstPublicSignal = ordered.find(signal => isCommercialCallStatus(signal.type)) || ordered[0]!;
    const lastSignal = ordered[ordered.length - 1]!;
    const acceptedSignal = ordered.find(signal => signal.type === 'accept');
    const terminatedSignal = [...ordered].reverse().find(signal => signal.type === 'terminate');
    const terminalSignal = [...ordered].reverse().find(signal => TERMINAL_STATUSES.has(signal.type));
    const durationSec = acceptedSignal && terminatedSignal
        ? Math.max(0, Math.round((signalTime(terminatedSignal) - signalTime(acceptedSignal)) / 1000))
        : null;
    const relayLatency = [...ordered]
        .reverse()
        .map(signal => signal.details?.latencyMs)
        .find(value => typeof value === 'number' && Number.isFinite(value));
    const direction: CommercialCallMetadata['direction'] = statuses.has('offer')
        ? 'incoming'
        : statuses.has('ringing')
            ? 'outgoing'
            : 'unknown';

    return {
        source: 'call',
        type: `call_${outcome}`,
        label,
        confidence,
        timestamp: lastSignal.timestamp,
        timestampUtc: lastSignal.timestampUtc,
        call: {
            outcome,
            direction,
            evidence,
            signalCount: ordered.length,
            technicalSignalCount: ordered.filter(signal => !isCommercialCallStatus(signal.type)).length,
            startedAt: firstPublicSignal.timestampUtc,
            endedAt: terminalSignal?.timestampUtc || null,
            durationSec,
            relayLatencyMs: typeof relayLatency === 'number' ? relayLatency : null,
            isVideo: ordered.some(signal => signal.details?.isVideo === true),
        },
    };
}
