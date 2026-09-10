export interface CallCapturePhases {
    baselineAvailable: boolean;
    baselineStartedAt: Date | null;
    baselineEndedAt: Date | null;
    negotiationStartedAt: Date | null;
    activeCallStartedAt: Date | null;
    callEndedAt?: Date | null;
    captureEndedAt?: Date | null;
    phaseEvidenceVersion?: 1;
    phaseEvidence?: CallCapturePhaseEvidence[];
}

export type CallCaptureTrigger = 'manual' | 'auto';

export const OPERATOR_CALL_MARKERS = [
    'call_started',
    'call_connected',
    'call_ended',
] as const;

export type OperatorCallMarker = typeof OPERATOR_CALL_MARKERS[number];

export function isOperatorCallMarker(value: string): value is OperatorCallMarker {
    return (OPERATOR_CALL_MARKERS as readonly string[]).includes(value.trim().toLowerCase());
}

export const CALL_CAPTURE_PHASE_STATUSES = [
    'offer',
    'ringing',
    'preaccept',
    'transport',
    'relaylatency',
    'accept',
    'reject',
    'timeout',
    'terminate',
] as const;

export type CallCapturePhaseStatus = typeof CALL_CAPTURE_PHASE_STATUSES[number];

export const CALL_CAPTURE_PHASE_CAPABILITY_VERSION = 2 as const;

export const CALL_CAPTURE_PHASE_EVIDENCE_SOURCES = [
    'capture_start',
    'capture_stop',
    'baileys_normalized',
    'baileys_raw',
    'operator_marker',
    'network_onset',
] as const;

export type CallCapturePhaseEvidenceSource = typeof CALL_CAPTURE_PHASE_EVIDENCE_SOURCES[number];

export const CALL_CAPTURE_PHASE_EVIDENCE_CONFIDENCES = [
    'system',
    'protocol',
    'operator_asserted',
    'inferred',
] as const;

export type CallCapturePhaseEvidenceConfidence = typeof CALL_CAPTURE_PHASE_EVIDENCE_CONFIDENCES[number];

export const CALL_CAPTURE_PHASE_EVIDENCE_KINDS = [
    'baseline_started',
    'negotiation_started',
    'active_started',
    'call_ended',
    'capture_ended',
] as const;

export type CallCapturePhaseEvidenceKind = typeof CALL_CAPTURE_PHASE_EVIDENCE_KINDS[number];

export interface CallCapturePhaseEvidence {
    sequence: number;
    kind: CallCapturePhaseEvidenceKind;
    at: Date;
    source: CallCapturePhaseEvidenceSource;
    confidence: CallCapturePhaseEvidenceConfidence;
    status?: CallCapturePhaseStatus;
}

export interface CallCapturePhaseObservation {
    source: CallCapturePhaseEvidenceSource;
    confidence: CallCapturePhaseEvidenceConfidence;
}

const EXPECTED_EVIDENCE_CONFIDENCE: Record<CallCapturePhaseEvidenceSource, CallCapturePhaseEvidenceConfidence> = {
    capture_start: 'system',
    capture_stop: 'system',
    baileys_normalized: 'protocol',
    baileys_raw: 'protocol',
    operator_marker: 'operator_asserted',
    network_onset: 'inferred',
};

export function isValidCallCapturePhaseObservation(
    source: CallCapturePhaseEvidenceSource,
    confidence: CallCapturePhaseEvidenceConfidence,
): boolean {
    return EXPECTED_EVIDENCE_CONFIDENCE[source] === confidence;
}

export function isCallCapturePhaseStatus(value: string): value is CallCapturePhaseStatus {
    return (CALL_CAPTURE_PHASE_STATUSES as readonly string[]).includes(normalizeStatus(value));
}

export interface CallCapturePhaseStart {
    captureCallId: string;
    targetJid: string;
    trigger: CallCaptureTrigger;
    observedCallId?: string;
    initialCallStatus?: string;
}

interface ActivePhaseLifecycle {
    captureCallId: string;
    targetJid: string;
    observedCallId: string | null;
    trigger: CallCaptureTrigger;
    phases: CallCapturePhases;
}

export type CapturePacketPhase = 'baseline' | 'call';

const NEGOTIATION_STATUSES = new Set([
    'offer',
    'ringing',
    'preaccept',
    'transport',
    'relaylatency',
]);

const ACTIVE_STATUSES = new Set(['accept']);
const TERMINAL_STATUSES = new Set(['reject', 'timeout', 'terminate']);

function cloneDate(value: Date | null): Date | null {
    return value ? new Date(value.getTime()) : null;
}

function clonePhases(phases: CallCapturePhases): CallCapturePhases {
    return {
        baselineAvailable: phases.baselineAvailable,
        baselineStartedAt: cloneDate(phases.baselineStartedAt),
        baselineEndedAt: cloneDate(phases.baselineEndedAt),
        negotiationStartedAt: cloneDate(phases.negotiationStartedAt),
        activeCallStartedAt: cloneDate(phases.activeCallStartedAt),
        ...(phases.callEndedAt === undefined ? {} : { callEndedAt: cloneDate(phases.callEndedAt) }),
        ...(phases.captureEndedAt === undefined ? {} : { captureEndedAt: cloneDate(phases.captureEndedAt) }),
        ...(phases.phaseEvidenceVersion === undefined ? {} : { phaseEvidenceVersion: phases.phaseEvidenceVersion }),
        ...(phases.phaseEvidence === undefined ? {} : {
            phaseEvidence: phases.phaseEvidence.map(event => ({
                ...event,
                at: new Date(event.at.getTime()),
            })),
        }),
    };
}

function normalizeStatus(value: string): string {
    return value.trim().toLowerCase();
}

function isAtOrAfter(value: Date, boundary: Date | null): boolean {
    return !boundary || value.getTime() >= boundary.getTime();
}

export class CallCapturePhaseLifecycle {
    private active: ActivePhaseLifecycle | null = null;

    constructor(private readonly now: () => Date = () => new Date()) {}

    start(input: CallCapturePhaseStart): boolean {
        if (this.active) return false;

        const startedAt = this.now();
        const phases: CallCapturePhases = {
            baselineAvailable: false,
            baselineStartedAt: input.trigger === 'manual' ? startedAt : null,
            baselineEndedAt: null,
            negotiationStartedAt: null,
            activeCallStartedAt: null,
            callEndedAt: null,
            captureEndedAt: null,
            phaseEvidenceVersion: 1,
            phaseEvidence: [],
        };
        this.active = {
            captureCallId: input.captureCallId,
            targetJid: input.targetJid,
            observedCallId: input.observedCallId ?? null,
            trigger: input.trigger,
            phases,
        };

        if (input.trigger === 'manual') {
            this.appendEvidence(phases, {
                kind: 'baseline_started',
                at: startedAt,
                source: 'capture_start',
                confidence: 'system',
            });
        }

        if (input.initialCallStatus) {
            this.observe(
                input.targetJid,
                input.observedCallId ?? input.captureCallId,
                input.initialCallStatus,
                { source: 'baileys_normalized', confidence: 'protocol' },
            );
        }
        return true;
    }

    markOperatorPhase(targetJid: string, marker: OperatorCallMarker): boolean {
        const active = this.active;
        if (!active || active.trigger !== 'manual' || active.targetJid !== targetJid) return false;
        if (active.phases.callEndedAt) return marker === 'call_ended';

        const transitionAt = this.now();
        if (!isAtOrAfter(transitionAt, active.phases.negotiationStartedAt)) return false;
        if (!isAtOrAfter(transitionAt, active.phases.activeCallStartedAt)) return false;

        if (marker === 'call_started') {
            if (active.phases.activeCallStartedAt) return false;
            if (active.phases.negotiationStartedAt) return true;
            this.closeBaseline(active.phases, transitionAt);
            active.phases.negotiationStartedAt = transitionAt;
            this.appendEvidence(active.phases, {
                kind: 'negotiation_started',
                at: transitionAt,
                source: 'operator_marker',
                confidence: 'operator_asserted',
            });
            return true;
        }

        if (!active.phases.negotiationStartedAt) return false;
        if (marker === 'call_connected') {
            if (active.phases.activeCallStartedAt) return true;
            active.phases.activeCallStartedAt = transitionAt;
            this.appendEvidence(active.phases, {
                kind: 'active_started',
                at: transitionAt,
                source: 'operator_marker',
                confidence: 'operator_asserted',
            });
            return true;
        }

        active.phases.callEndedAt = transitionAt;
        this.appendEvidence(active.phases, {
            kind: 'call_ended',
            at: transitionAt,
            source: 'operator_marker',
            confidence: 'operator_asserted',
        });
        return true;
    }

    observe(
        targetJid: string,
        observedCallId: string,
        status: string,
        observation: CallCapturePhaseObservation = {
            source: 'baileys_normalized',
            confidence: 'protocol',
        },
    ): boolean {
        if (!isValidCallCapturePhaseObservation(observation.source, observation.confidence)) return false;
        const active = this.active;
        if (!active || active.targetJid !== targetJid) return false;
        if (active.observedCallId && active.observedCallId !== observedCallId) return false;

        const normalizedStatus = normalizeStatus(status);
        if (
            !NEGOTIATION_STATUSES.has(normalizedStatus)
            && !ACTIVE_STATUSES.has(normalizedStatus)
            && !TERMINAL_STATUSES.has(normalizedStatus)
        ) {
            return false;
        }

        if (active.phases.callEndedAt) return TERMINAL_STATUSES.has(normalizedStatus);

        active.observedCallId ??= observedCallId;
        if (TERMINAL_STATUSES.has(normalizedStatus)) {
            const endedAt = this.now();
            if (!isAtOrAfter(endedAt, active.phases.negotiationStartedAt)) return false;
            if (!isAtOrAfter(endedAt, active.phases.activeCallStartedAt)) return false;
            active.phases.callEndedAt = endedAt;
            this.appendEvidence(active.phases, {
                kind: 'call_ended',
                at: endedAt,
                source: observation.source,
                confidence: observation.confidence,
                status: normalizedStatus as CallCapturePhaseStatus,
            });
            return true;
        }

        // Once the active media phase has been observed, a late negotiation
        // signal is not allowed to move the remote lifecycle backwards.
        if (active.phases.activeCallStartedAt && NEGOTIATION_STATUSES.has(normalizedStatus)) {
            return false;
        }

        const transitionAt = this.now();
        if (!isAtOrAfter(transitionAt, active.phases.negotiationStartedAt)) return false;
        if (!isAtOrAfter(transitionAt, active.phases.activeCallStartedAt)) return false;

        this.closeBaseline(active.phases, transitionAt);

        if (!active.phases.negotiationStartedAt) {
            active.phases.negotiationStartedAt = transitionAt;
            this.appendEvidence(active.phases, {
                kind: 'negotiation_started',
                at: transitionAt,
                source: observation.source,
                confidence: observation.confidence,
                status: normalizedStatus as CallCapturePhaseStatus,
            });
        }
        if (ACTIVE_STATUSES.has(normalizedStatus) && !active.phases.activeCallStartedAt) {
            active.phases.activeCallStartedAt = transitionAt;
            this.appendEvidence(active.phases, {
                kind: 'active_started',
                at: transitionAt,
                source: observation.source,
                confidence: observation.confidence,
                status: normalizedStatus as CallCapturePhaseStatus,
            });
        }
        return true;
    }

    finish(captureCallId: string, targetJid: string, endedAt: Date = this.now()): CallCapturePhases | null {
        const active = this.active;
        if (!active || active.captureCallId !== captureCallId || active.targetJid !== targetJid) return null;

        if (active.phases.baselineStartedAt && !active.phases.baselineEndedAt) {
            if (endedAt.getTime() > active.phases.baselineStartedAt.getTime()) {
                active.phases.baselineEndedAt = endedAt;
                active.phases.baselineAvailable = true;
            } else {
                active.phases.baselineStartedAt = null;
                this.removeEvidence(active.phases, 'baseline_started');
            }
        }

        active.phases.captureEndedAt = endedAt;
        this.appendEvidence(active.phases, {
            kind: 'capture_ended',
            at: endedAt,
            source: 'capture_stop',
            confidence: 'system',
        });

        const phases = clonePhases(active.phases);
        this.active = null;
        return phases;
    }

    reset(): void {
        this.active = null;
    }

    snapshot(): CallCapturePhases | null {
        return this.active ? clonePhases(this.active.phases) : null;
    }

    private appendEvidence(
        phases: CallCapturePhases,
        event: Omit<CallCapturePhaseEvidence, 'sequence'>,
    ): void {
        const evidence = phases.phaseEvidence;
        if (!evidence) return;
        evidence.push({ ...event, sequence: evidence.length + 1 });
    }

    private closeBaseline(phases: CallCapturePhases, transitionAt: Date): void {
        if (!phases.baselineStartedAt || phases.baselineEndedAt) return;
        if (transitionAt.getTime() > phases.baselineStartedAt.getTime()) {
            phases.baselineEndedAt = transitionAt;
            phases.baselineAvailable = true;
            return;
        }
        phases.baselineStartedAt = null;
        this.removeEvidence(phases, 'baseline_started');
    }

    private removeEvidence(phases: CallCapturePhases, kind: CallCapturePhaseEvidenceKind): void {
        const evidence = phases.phaseEvidence;
        if (!evidence) return;
        phases.phaseEvidence = evidence
            .filter(event => event.kind !== kind)
            .map((event, index) => ({ ...event, sequence: index + 1 }));
    }
}

export function classifyCapturePacketPhase(
    timestamp: Date,
    phases: CallCapturePhases | undefined,
): CapturePacketPhase {
    if (!phases?.baselineAvailable || !phases.baselineStartedAt || !phases.baselineEndedAt) {
        return 'call';
    }
    const time = timestamp.getTime();
    if (time >= phases.baselineStartedAt.getTime() && time < phases.baselineEndedAt.getTime()) {
        return 'baseline';
    }
    return 'call';
}
