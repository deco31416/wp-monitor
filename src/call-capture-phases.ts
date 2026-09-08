export interface CallCapturePhases {
    baselineAvailable: boolean;
    baselineStartedAt: Date | null;
    baselineEndedAt: Date | null;
    negotiationStartedAt: Date | null;
    activeCallStartedAt: Date | null;
}

export type CallCaptureTrigger = 'manual' | 'auto';

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
        };
        this.active = {
            captureCallId: input.captureCallId,
            targetJid: input.targetJid,
            observedCallId: input.observedCallId ?? null,
            phases,
        };

        if (input.initialCallStatus) {
            this.observe(input.targetJid, input.observedCallId ?? input.captureCallId, input.initialCallStatus);
        }
        return true;
    }

    observe(targetJid: string, observedCallId: string, status: string): boolean {
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

        active.observedCallId ??= observedCallId;
        if (TERMINAL_STATUSES.has(normalizedStatus)) return true;

        const transitionAt = this.now();
        if (!isAtOrAfter(transitionAt, active.phases.negotiationStartedAt)) return false;
        if (!isAtOrAfter(transitionAt, active.phases.activeCallStartedAt)) return false;

        if (active.phases.baselineStartedAt && !active.phases.baselineEndedAt) {
            if (transitionAt.getTime() > active.phases.baselineStartedAt.getTime()) {
                active.phases.baselineEndedAt = transitionAt;
                active.phases.baselineAvailable = true;
            } else {
                active.phases.baselineStartedAt = null;
            }
        }

        if (!active.phases.negotiationStartedAt) {
            active.phases.negotiationStartedAt = transitionAt;
        }
        if (ACTIVE_STATUSES.has(normalizedStatus) && !active.phases.activeCallStartedAt) {
            active.phases.activeCallStartedAt = transitionAt;
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
            }
        }

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
