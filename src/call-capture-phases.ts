export interface CallCapturePhases {
    baselineAvailable: boolean;
    baselineStartedAt: Date | null;
    baselineEndedAt: Date | null;
    negotiationStartedAt: Date | null;
    activeCallStartedAt: Date | null;
    callEndedAt?: Date | null;
    captureEndedAt?: Date | null;
    phaseEvidenceVersion?: 1 | 2;
    phaseEvidence?: CallCapturePhaseEvidence[];
}

export const CALL_CAPTURE_PHASE_COUNTS_VERSION = 1 as const;

export type DetailedCapturePacketPhase =
    | 'baseline'
    | 'negotiation'
    | 'active'
    | 'postCall'
    | 'unclassified';

export interface CallCapturePhaseCount {
    packets: number;
    bytes: number;
}

export interface CallCapturePhaseCounts {
    version: typeof CALL_CAPTURE_PHASE_COUNTS_VERSION;
    baseline: CallCapturePhaseCount;
    negotiation: CallCapturePhaseCount;
    active: CallCapturePhaseCount;
    postCall: CallCapturePhaseCount;
    unclassified: CallCapturePhaseCount;
}

export function createCallCapturePhaseCounts(): CallCapturePhaseCounts {
    return {
        version: CALL_CAPTURE_PHASE_COUNTS_VERSION,
        baseline: { packets: 0, bytes: 0 },
        negotiation: { packets: 0, bytes: 0 },
        active: { packets: 0, bytes: 0 },
        postCall: { packets: 0, bytes: 0 },
        unclassified: { packets: 0, bytes: 0 },
    };
}

export function recordCallCapturePhasePacket(
    counts: CallCapturePhaseCounts,
    phase: DetailedCapturePacketPhase,
    bytes: number,
): void {
    counts[phase].packets += 1;
    counts[phase].bytes += bytes;
}

export function normalizeCallCapturePhaseCounts(value: unknown): CallCapturePhaseCounts | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const object = value as Record<string, unknown>;
    if (object.version !== CALL_CAPTURE_PHASE_COUNTS_VERSION) return undefined;

    const normalizeCount = (phase: DetailedCapturePacketPhase): CallCapturePhaseCount | undefined => {
        const value = object[phase];
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        const count = value as Record<string, unknown>;
        if (!Number.isSafeInteger(count.packets) || Number(count.packets) < 0) return undefined;
        if (!Number.isSafeInteger(count.bytes) || Number(count.bytes) < 0) return undefined;
        return { packets: Number(count.packets), bytes: Number(count.bytes) };
    };

    const baseline = normalizeCount('baseline');
    const negotiation = normalizeCount('negotiation');
    const active = normalizeCount('active');
    const postCall = normalizeCount('postCall');
    const unclassified = normalizeCount('unclassified');
    if (!baseline || !negotiation || !active || !postCall || !unclassified) return undefined;
    return {
        version: CALL_CAPTURE_PHASE_COUNTS_VERSION,
        baseline,
        negotiation,
        active,
        postCall,
        unclassified,
    };
}

export function sumCallCapturePhaseCounts(counts: CallCapturePhaseCounts): CallCapturePhaseCount {
    return [counts.baseline, counts.negotiation, counts.active, counts.postCall, counts.unclassified]
        .reduce((total, count) => ({
            packets: total.packets + count.packets,
            bytes: total.bytes + count.bytes,
        }), { packets: 0, bytes: 0 });
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

export const CALL_CAPTURE_PHASE_CAPABILITY_VERSION = 4 as const;

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
    corroborations?: CallCapturePhaseCorroboration[];
}

export interface CallCapturePhaseCorroboration {
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
                ...(event.corroborations === undefined ? {} : {
                    corroborations: event.corroborations.map(corroboration => ({
                        ...corroboration,
                        at: new Date(corroboration.at.getTime()),
                    })),
                }),
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
            phaseEvidenceVersion: 2,
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
        if (active.phases.callEndedAt) {
            return marker === 'call_ended' && this.corroborate(
                active.phases,
                'call_ended',
                this.now(),
                { source: 'operator_marker', confidence: 'operator_asserted' },
            );
        }

        const transitionAt = this.now();
        if (!isAtOrAfter(transitionAt, active.phases.negotiationStartedAt)) return false;
        if (!isAtOrAfter(transitionAt, active.phases.activeCallStartedAt)) return false;

        if (marker === 'call_started') {
            if (active.phases.activeCallStartedAt) return false;
            if (active.phases.negotiationStartedAt) {
                return this.corroborate(
                    active.phases,
                    'negotiation_started',
                    transitionAt,
                    { source: 'operator_marker', confidence: 'operator_asserted' },
                );
            }
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
            if (active.phases.activeCallStartedAt) {
                return this.corroborate(
                    active.phases,
                    'active_started',
                    transitionAt,
                    { source: 'operator_marker', confidence: 'operator_asserted' },
                );
            }
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

    markNetworkOnset(targetJid: string, onsetAt: Date): boolean {
        const active = this.active;
        if (!active || active.trigger !== 'manual' || active.targetJid !== targetJid) return false;
        if (!Number.isFinite(onsetAt.getTime()) || !isAtOrAfter(onsetAt, active.phases.baselineStartedAt)) return false;
        if (active.phases.activeCallStartedAt || active.phases.callEndedAt) return false;
        if (active.phases.negotiationStartedAt) {
            return this.corroborate(
                active.phases,
                'negotiation_started',
                onsetAt,
                { source: 'network_onset', confidence: 'inferred' },
            );
        }

        this.closeBaseline(active.phases, onsetAt);
        if (!active.phases.baselineAvailable) return false;
        active.phases.negotiationStartedAt = new Date(onsetAt);
        this.appendEvidence(active.phases, {
            kind: 'negotiation_started',
            at: new Date(onsetAt),
            source: 'network_onset',
            confidence: 'inferred',
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
        if (observation.source !== 'baileys_normalized' && observation.source !== 'baileys_raw') return false;
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

        if (active.phases.callEndedAt) {
            if (!TERMINAL_STATUSES.has(normalizedStatus)) return false;
            const accepted = this.corroborate(
                active.phases,
                'call_ended',
                this.now(),
                observation,
                normalizedStatus as CallCapturePhaseStatus,
            );
            if (accepted) active.observedCallId ??= observedCallId;
            return accepted;
        }

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
            active.observedCallId ??= observedCallId;
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
        } else if (NEGOTIATION_STATUSES.has(normalizedStatus) || ACTIVE_STATUSES.has(normalizedStatus)) {
            if (!this.corroborate(
                active.phases,
                'negotiation_started',
                transitionAt,
                observation,
                normalizedStatus as CallCapturePhaseStatus,
            )) return false;
        }
        if (ACTIVE_STATUSES.has(normalizedStatus)) {
            if (!active.phases.activeCallStartedAt) {
                active.phases.activeCallStartedAt = transitionAt;
                this.appendEvidence(active.phases, {
                    kind: 'active_started',
                    at: transitionAt,
                    source: observation.source,
                    confidence: observation.confidence,
                    status: normalizedStatus as CallCapturePhaseStatus,
                });
            } else if (!this.corroborate(
                active.phases,
                'active_started',
                transitionAt,
                observation,
                normalizedStatus as CallCapturePhaseStatus,
            )) return false;
        }
        active.observedCallId ??= observedCallId;
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

    private corroborate(
        phases: CallCapturePhases,
        kind: CallCapturePhaseEvidenceKind,
        at: Date,
        observation: CallCapturePhaseObservation,
        status?: CallCapturePhaseStatus,
    ): boolean {
        if (!isValidCallCapturePhaseObservation(observation.source, observation.confidence)) return false;
        const event = phases.phaseEvidence?.find(candidate => candidate.kind === kind);
        if (!event || !Number.isFinite(at.getTime()) || at.getTime() < event.at.getTime()) return false;
        if (event.source === observation.source) return true;

        const corroborations = event.corroborations ?? [];
        if (corroborations.some(candidate => candidate.source === observation.source)) return true;
        if (corroborations.length >= 3) return false;
        const previous = corroborations[corroborations.length - 1];
        if (previous && at.getTime() < previous.at.getTime()) return false;
        event.corroborations = [
            ...corroborations,
            {
                at: new Date(at),
                source: observation.source,
                confidence: observation.confidence,
                ...(status === undefined ? {} : { status }),
            },
        ];
        return true;
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

export function classifyDetailedCapturePacketPhase(
    timestamp: Date,
    phases: CallCapturePhases | undefined,
): DetailedCapturePacketPhase {
    const time = timestamp.getTime();
    if (!Number.isFinite(time) || !phases) return 'unclassified';

    const captureEnd = phases.captureEndedAt?.getTime();
    if (captureEnd !== undefined && time > captureEnd) return 'unclassified';

    const callEnd = phases.callEndedAt?.getTime();
    if (callEnd !== undefined && time >= callEnd) return 'postCall';

    const activeStart = phases.activeCallStartedAt?.getTime();
    if (activeStart !== undefined && time >= activeStart) return 'active';

    const negotiationStart = phases.negotiationStartedAt?.getTime();
    if (negotiationStart !== undefined && time >= negotiationStart) return 'negotiation';

    if (phases.baselineAvailable && phases.baselineStartedAt && phases.baselineEndedAt) {
        const baselineStart = phases.baselineStartedAt.getTime();
        const baselineEnd = phases.baselineEndedAt.getTime();
        if (time >= baselineStart && time < baselineEnd) return 'baseline';
    }

    return 'unclassified';
}
