import {
    isCallCapturePhaseStatus,
    type CallCapturePhaseStatus,
} from './call-capture-phases.js';

export type CallCaptureCorrelationSource = 'baileys' | 'raw_transport';

export interface CallCaptureCorrelationInput {
    source: CallCaptureCorrelationSource;
    targetJid: string;
    observedCallId: string;
    status: string;
}

export interface CallCaptureCorrelationResult {
    source: CallCaptureCorrelationSource;
    status: CallCapturePhaseStatus | null;
    accepted: boolean;
    bindObservedCall: boolean;
}

export interface ActiveCallCorrelationContext {
    targetJid: string;
    captureCallId: string;
    observedCallId?: string;
}

export type CallCapturePhaseObserver = (
    targetJid: string,
    observedCallId: string,
    status: CallCapturePhaseStatus,
) => Promise<boolean>;

const BINDABLE_PHASE_STATUSES = new Set<CallCapturePhaseStatus>([
    'offer',
    'ringing',
    'preaccept',
    'transport',
    'relaylatency',
    'accept',
]);

export function canBindObservedCall(
    result: CallCaptureCorrelationResult,
    active: ActiveCallCorrelationContext | null,
    targetJid: string,
    observedCallId: string,
): boolean {
    return Boolean(
        result.bindObservedCall
        && active
        && active.targetJid === targetJid
        && active.captureCallId !== observedCallId
        && !active.observedCallId,
    );
}

/**
 * Routes normalized and raw call observations through one phase contract.
 * It deliberately does not start captures or infer route/IP ownership.
 */
export async function correlateCallCapturePhase(
    observe: CallCapturePhaseObserver,
    input: CallCaptureCorrelationInput,
): Promise<CallCaptureCorrelationResult> {
    const status = input.status.trim().toLowerCase();
    if (!input.targetJid || !input.observedCallId || !isCallCapturePhaseStatus(status)) {
        return {
            source: input.source,
            status: null,
            accepted: false,
            bindObservedCall: false,
        };
    }

    const accepted = await observe(input.targetJid, input.observedCallId, status);
    return {
        source: input.source,
        status,
        accepted,
        bindObservedCall: accepted && BINDABLE_PHASE_STATUSES.has(status),
    };
}
