import type { OperatorCallMarker } from './call-capture-phases.js';

export interface OperatorCallMarkerScope {
    caseId: string;
    targetJid: string;
    callId: string;
}

export interface OperatorCallMarkerRequest extends OperatorCallMarkerScope {
    marker: OperatorCallMarker;
}

export type OperatorCallMarkerDisposition = 'advance' | 'idempotent' | 'reject';

export function getOperatorCallMarkerDisposition(
    current: OperatorCallMarker | undefined,
    requested: OperatorCallMarker,
): OperatorCallMarkerDisposition {
    if (current === requested) return 'idempotent';
    if (!current) return requested === 'call_started' ? 'advance' : 'reject';
    if (current === 'call_started') return requested === 'call_connected' || requested === 'call_ended'
        ? 'advance'
        : 'reject';
    if (current === 'call_connected') return requested === 'call_ended' ? 'advance' : 'reject';
    return 'reject';
}

export function matchesActiveOperatorCallMarkerScope(
    active: OperatorCallMarkerScope | null,
    request: OperatorCallMarkerRequest,
): boolean {
    return Boolean(
        active
        && active.caseId === request.caseId
        && active.targetJid === request.targetJid
        && active.callId === request.callId,
    );
}
