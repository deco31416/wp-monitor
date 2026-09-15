import { createHash } from 'node:crypto';
import {
    autoDetectInterface,
    getCallCaptureStatus,
    markOperatorCallCapturePhase,
    observeCallCapturePhase,
    startCallCapture,
    stopCallCapture,
} from './call-analyzer.js';
import type { CallAnalysisResult, CallCaptureStatus } from './call-analyzer.js';
import { CaptureAgentClient, CaptureAgentClientError } from './capture-agent-client.js';
import { hasPacketCapturePrivileges } from './capture-permissions.js';
import { listInterfaces } from './packet-capture.js';
import type { NetworkInterface } from './packet-capture.js';
import type { CallCaptureMode } from './runtime.js';
import type { BrowserWebRtcEvidence } from './call-observation-evidence.js';
import {
    WebRtcObserverClient,
    WebRtcObserverClientError,
    type WebRtcObserverStatus,
} from './webrtc-observer-client.js';
import {
    isCallCapturePhaseStatus,
    type CallCapturePhaseObservation,
    type CallCapturePhaseStatus,
    type OperatorCallMarker,
} from './call-capture-phases.js';

export interface CallCaptureServiceOptions {
    mode: CallCaptureMode;
    agent?: CaptureAgentClient;
    observer?: WebRtcObserverClient;
    observerTtlMs?: number;
    startupTimeoutMs?: number;
    startupVerificationDelayMs?: number;
    lifecycleLogger?: (event: CallCaptureLifecycleLog) => void;
}

export type CallPacketCallback = (packet: unknown) => void;

export interface CallCaptureStartContext {
    trigger: 'manual' | 'auto';
    observedCallId?: string;
    initialCallStatus?: CallCapturePhaseStatus;
}

export interface CallCaptureLifecycleLog {
    event: 'coordinated_start_failed';
    callIdHash: string;
    causes: string[];
    compensation: 'complete' | 'failed';
}

export class CallCaptureCoordinationError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code:
            | 'call_capture_start_incomplete'
            | 'call_capture_compensation_failed'
            | 'call_capture_already_active',
    ) {
        super(message);
        this.name = 'CallCaptureCoordinationError';
    }
}

class CallCaptureStartupTimeoutError extends Error {
    constructor() {
        super('Call capture coordinated startup timed out');
        this.name = 'CallCaptureStartupTimeoutError';
    }
}

interface CoordinatedCaptureStatus {
    packet: CallCaptureStatus | null;
    observer: WebRtcObserverStatus | null;
    causes: string[];
}

interface CallCaptureCompensationOutcome {
    complete: boolean;
    causes: string[];
    packet: CallCaptureStatus | null;
    observer: WebRtcObserverStatus | null;
}

const EMPTY_STATUS: CallCaptureStatus = {
    isCapturing: false,
    targetJid: null,
    callId: null,
    startTime: null,
    packetsCollected: 0,
    elapsed: 0,
};

export class CallCaptureService {
    private readonly mode: CallCaptureMode;
    private readonly agent: CaptureAgentClient | null;
    private readonly observer: WebRtcObserverClient | null;
    private readonly observerTtlMs: number;
    private readonly startupTimeoutMs: number;
    private readonly startupVerificationDelayMs: number;
    private readonly lifecycleLogger: (event: CallCaptureLifecycleLog) => void;
    private agentAvailable = false;
    private observerAvailable = false;
    private activeAgentCapture: { callId: string; targetJid: string } | null = null;
    private activeObserverCapture: {
        callId: string;
        targetJid: string;
        startedAt: Date;
        trigger: CallCaptureStartContext['trigger'] | 'recovered';
    } | null = null;
    private completedObserverEvidence: {
        callId: string;
        evidence: BrowserWebRtcEvidence;
        trigger: CallCaptureStartContext['trigger'] | 'recovered';
    } | null = null;
    private observerStartFailure: { callId: string; startedAt: Date; limitation: string } | null = null;
    private observerLifecycleTail: Promise<void> = Promise.resolve();

    constructor(options: CallCaptureServiceOptions) {
        if (options.mode === 'agent' && !options.agent) {
            throw new Error('Capture agent mode requires an initialized CaptureAgentClient');
        }
        if (options.mode !== 'agent' && options.agent) {
            throw new Error('Capture agent client is only valid in agent mode');
        }
        this.mode = options.mode;
        this.agent = options.agent ?? null;
        this.observer = options.observer ?? null;
        this.observerTtlMs = options.observerTtlMs ?? 15 * 60_000;
        if (!Number.isSafeInteger(this.observerTtlMs) || this.observerTtlMs < 30_000 || this.observerTtlMs > 30 * 60_000) {
            throw new Error('WebRTC observer TTL must be between 30 seconds and 30 minutes');
        }
        this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
        if (!Number.isSafeInteger(this.startupTimeoutMs) || this.startupTimeoutMs < 10 || this.startupTimeoutMs > 60_000) {
            throw new Error('Call capture startup timeout must be between 10 milliseconds and 60 seconds');
        }
        this.startupVerificationDelayMs = options.startupVerificationDelayMs ?? 0;
        if (
            !Number.isSafeInteger(this.startupVerificationDelayMs)
            || this.startupVerificationDelayMs < 0
            || this.startupVerificationDelayMs > 5_000
        ) {
            throw new Error('Call capture startup verification delay must be between 0 and 5 seconds');
        }
        this.lifecycleLogger = options.lifecycleLogger ?? (event => {
            console.warn(
                `[CALL-CAPTURE] ${event.event} callIdHash=${event.callIdHash}`
                + ` causes=${event.causes.join(',')} compensation=${event.compensation}`,
            );
        });
    }

    getMode(): CallCaptureMode {
        return this.mode;
    }

    isEnabled(): boolean {
        return this.mode !== 'disabled';
    }

    isAvailable(): boolean {
        if (this.mode === 'local') return hasPacketCapturePrivileges();
        if (this.mode === 'agent') return this.agentAvailable;
        return false;
    }

    async refreshAvailability(): Promise<boolean> {
        if (this.observer) this.observerAvailable = await this.observer.ready();
        if (this.mode === 'local') {
            const available = hasPacketCapturePrivileges();
            if (available && this.observer) {
                await this.reconcileObserverScope();
            }
            return available;
        }
        if (this.mode === 'disabled') return false;
        this.agentAvailable = await this.agent!.ready();
        if (this.agentAvailable && this.observer) {
            try {
                await this.reconcileObserverScope();
            } catch {
                this.agentAvailable = false;
            }
        }
        return this.agentAvailable;
    }

    isObserverAvailable(): boolean {
        return this.observerAvailable;
    }

    async listInterfaces(): Promise<NetworkInterface[]> {
        if (this.mode === 'local') return listInterfaces();
        if (this.mode === 'agent') return this.agent!.listInterfaces();
        return [];
    }

    async autoDetectInterface(): Promise<string | null> {
        if (this.mode === 'local') return autoDetectInterface();
        if (this.mode === 'disabled') return null;
        const interfaces = await this.listInterfaces();
        return interfaces.find(item => !item.address.startsWith('127.'))?.address ?? null;
    }

    async getStatus(): Promise<CallCaptureStatus> {
        if (this.mode === 'local') return getCallCaptureStatus();
        if (this.mode === 'agent') {
            const status = await this.agent!.getCallCaptureStatus();
            this.activeAgentCapture = status.isCapturing && status.callId && status.targetJid
                ? { callId: status.callId, targetJid: status.targetJid }
                : null;
            return status;
        }
        return { ...EMPTY_STATUS };
    }

    async start(
        interfaceAddr: string,
        targetJid: string,
        callId: string,
        isVideo: boolean,
        packetCallback?: CallPacketCallback,
        context: CallCaptureStartContext = { trigger: 'manual' },
    ): Promise<boolean> {
        return this.withObserverLifecycle(() => this.startWithinObserverLifecycle(
            interfaceAddr,
            targetJid,
            callId,
            isVideo,
            packetCallback,
            context,
        ));
    }

    private async startWithinObserverLifecycle(
        interfaceAddr: string,
        targetJid: string,
        callId: string,
        isVideo: boolean,
        packetCallback?: CallPacketCallback,
        context: CallCaptureStartContext = { trigger: 'manual' },
    ): Promise<boolean> {
        const localCaptureActive = this.mode === 'local' && getCallCaptureStatus().isCapturing;
        if (localCaptureActive || this.activeAgentCapture || this.activeObserverCapture) {
            throw new CallCaptureCoordinationError(
                'Ya existe una captura de llamada activa',
                409,
                'call_capture_already_active',
            );
        }
        this.completedObserverEvidence = null;
        this.observerStartFailure = null;
        this.activeAgentCapture = null;
        this.activeObserverCapture = null;

        const packetStart = Promise.resolve().then(() => {
            if (this.mode === 'local') {
                return startCallCapture(interfaceAddr, targetJid, callId, isVideo, packetCallback, context);
            }
            if (this.mode === 'agent') {
                return this.agent!.startCallCapture({ interfaceAddr, targetJid, callId, isVideo, ...context });
            }
            return false;
        });
        const observerStart = this.observer
            ? this.observer.start(callId, targetJid, this.observerTtlMs).then(() => true)
            : Promise.resolve(true);

        let startResults: PromiseSettledResult<boolean>[] | null = null;
        const causes: string[] = [];
        try {
            startResults = await this.withStartupTimeout(Promise.allSettled([packetStart, observerStart]));
        } catch (error) {
            causes.push(error instanceof CallCaptureStartupTimeoutError
                ? 'startup_timeout'
                : 'startup_coordination_failed');
        }

        if (startResults) {
            const [packetResult, observerResult] = startResults;
            if (!packetResult || packetResult.status === 'rejected') causes.push('capture_start_request_failed');
            else if (packetResult.value !== true) causes.push('capture_start_rejected');
            if (!observerResult || observerResult.status === 'rejected') causes.push('observer_start_request_failed');
            else if (observerResult.value !== true) causes.push('observer_start_rejected');
        }

        let verified = await this.readCoordinatedStatus();
        causes.push(...verified.causes);
        let packetActive = this.matchesPacketScope(verified.packet, callId, targetJid);
        let observerActive = !this.observer || this.matchesObserverScope(verified.observer, callId, targetJid);
        if (!packetActive) causes.push('capture_post_start_inactive');
        if (!observerActive) causes.push('observer_post_start_inactive');

        if (causes.length === 0 && context.trigger === 'manual' && this.startupVerificationDelayMs > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, this.startupVerificationDelayMs));
            verified = await this.readCoordinatedStatus();
            causes.push(...verified.causes.map(cause => `stability_${cause}`));
            packetActive = this.matchesPacketScope(verified.packet, callId, targetJid);
            observerActive = !this.observer || this.matchesObserverScope(verified.observer, callId, targetJid);
            if (!packetActive) causes.push('capture_stability_check_inactive');
            if (!observerActive) causes.push('observer_stability_check_inactive');
        }

        if (causes.length === 0 && verified.packet) {
            if (this.mode === 'agent') {
                this.activeAgentCapture = { callId, targetJid };
                this.agentAvailable = true;
            }
            if (this.observer && verified.observer?.startedAt) {
                this.activeObserverCapture = {
                    callId,
                    targetJid,
                    startedAt: verified.observer.startedAt,
                    trigger: context.trigger,
                };
                this.observerAvailable = true;
            }
            return true;
        }

        const compensation = await this.compensateFailedStart(callId);
        const packetAfterCompensation = compensation.packet ?? verified.packet;
        const observerAfterCompensation = compensation.observer ?? verified.observer;
        this.activeAgentCapture = this.mode === 'agent'
            && !compensation.complete
            && packetAfterCompensation?.isCapturing
            && packetAfterCompensation.callId
            && packetAfterCompensation.targetJid
            ? { callId: packetAfterCompensation.callId, targetJid: packetAfterCompensation.targetJid }
            : null;
        this.activeObserverCapture = !compensation.complete
            && observerAfterCompensation?.active
            && observerAfterCompensation.callId
            && observerAfterCompensation.targetJid
            && observerAfterCompensation.startedAt
            ? {
                callId: observerAfterCompensation.callId,
                targetJid: observerAfterCompensation.targetJid,
                startedAt: observerAfterCompensation.startedAt,
                trigger: 'recovered',
            }
            : null;
        this.completedObserverEvidence = null;
        this.observerStartFailure = null;
        const uniqueCauses = [...new Set([...causes, ...compensation.causes])];
        try {
            this.lifecycleLogger({
                event: 'coordinated_start_failed',
                callIdHash: createHash('sha256').update(callId).digest('hex').slice(0, 16),
                causes: uniqueCauses,
                compensation: compensation.complete ? 'complete' : 'failed',
            });
        } catch {
            // Observability must not replace the controlled coordination error.
        }
        if (!compensation.complete) {
            throw new CallCaptureCoordinationError(
                'No fue posible iniciar ni compensar completamente la captura coordinada',
                503,
                'call_capture_compensation_failed',
            );
        }
        throw new CallCaptureCoordinationError(
            'No fue posible verificar el inicio coordinado de la captura',
            503,
            'call_capture_start_incomplete',
        );
    }

    private async readCoordinatedStatus(): Promise<CoordinatedCaptureStatus> {
        const packetStatus = Promise.resolve().then(() => {
            if (this.mode === 'local') return getCallCaptureStatus();
            if (this.mode === 'agent') return this.agent!.getCallCaptureStatus();
            return { ...EMPTY_STATUS };
        });
        const observerStatus = this.observer ? this.observer.status() : Promise.resolve(null);
        try {
            const [packetResult, observerResult] = await this.withStartupTimeout(
                Promise.allSettled([packetStatus, observerStatus]),
            );
            const causes: string[] = [];
            if (packetResult.status === 'rejected') causes.push('capture_status_check_failed');
            if (observerResult.status === 'rejected') causes.push('observer_status_check_failed');
            return {
                packet: packetResult.status === 'fulfilled' ? packetResult.value : null,
                observer: observerResult.status === 'fulfilled' ? observerResult.value : null,
                causes,
            };
        } catch {
            return { packet: null, observer: null, causes: ['startup_status_timeout'] };
        }
    }

    private matchesPacketScope(status: CallCaptureStatus | null, callId: string, targetJid: string): boolean {
        return status?.isCapturing === true && status.callId === callId && status.targetJid === targetJid;
    }

    private matchesObserverScope(status: WebRtcObserverStatus | null, callId: string, targetJid: string): boolean {
        return status?.active === true && status.instrumentationActive !== false
            && status.callId === callId && status.targetJid === targetJid;
    }

    private async compensateFailedStart(callId: string): Promise<CallCaptureCompensationOutcome> {
        const stopPacket = Promise.resolve().then(async () => {
            if (this.mode === 'local') {
                stopCallCapture();
                return;
            }
            if (this.mode !== 'agent') return;
            try {
                await this.agent!.stopCallCapture(callId);
            } catch (error) {
                if (error instanceof CaptureAgentClientError && error.code === 'capture_not_active') return;
                throw error;
            }
        });
        const stopObserver = Promise.resolve().then(async () => {
            if (!this.observer) return;
            try {
                await this.observer.stop(callId);
            } catch (error) {
                if (error instanceof WebRtcObserverClientError && error.code === 'observer_scope_mismatch') return;
                throw error;
            }
        });

        let stopResults: PromiseSettledResult<void>[] | null = null;
        const causes: string[] = [];
        try {
            stopResults = await this.withStartupTimeout(Promise.allSettled([stopPacket, stopObserver]));
        } catch {
            causes.push('compensation_timeout');
        }
        if (stopResults?.[0]?.status === 'rejected') causes.push('capture_compensation_stop_failed');
        if (stopResults?.[1]?.status === 'rejected') causes.push('observer_compensation_stop_failed');

        const after = await this.readCoordinatedStatus();
        if (after.causes.includes('capture_status_check_failed')) causes.push('capture_compensation_status_failed');
        if (after.causes.includes('observer_status_check_failed')) causes.push('observer_compensation_status_failed');
        if (after.causes.includes('startup_status_timeout')) causes.push('compensation_status_timeout');
        if (after.packet?.isCapturing === true) causes.push('capture_residual_active');
        if (after.observer?.active === true) causes.push('observer_residual_active');
        return {
            complete: causes.length === 0,
            causes,
            packet: after.packet,
            observer: after.observer,
        };
    }

    private async withStartupTimeout<T>(operation: Promise<T>): Promise<T> {
        let timer: NodeJS.Timeout | null = null;
        try {
            return await Promise.race([
                operation,
                new Promise<never>((_resolve, reject) => {
                    timer = setTimeout(() => reject(new CallCaptureStartupTimeoutError()), this.startupTimeoutMs);
                    timer.unref?.();
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async observeCallEvent(
        targetJid: string,
        observedCallId: string,
        status: string,
        observation: CallCapturePhaseObservation = {
            source: 'baileys_normalized',
            confidence: 'protocol',
        },
    ): Promise<boolean> {
        if (!isCallCapturePhaseStatus(status)) return false;
        if (this.mode === 'local') return observeCallCapturePhase(targetJid, observedCallId, status, observation);
        if (this.mode !== 'agent' || !this.activeAgentCapture) return false;
        return this.agent!.observeCallCapturePhase({
            captureCallId: this.activeAgentCapture.callId,
            targetJid,
            observedCallId,
            status,
            evidenceSource: observation.source,
            evidenceConfidence: observation.confidence,
        });
    }

    async markOperatorPhase(targetJid: string, marker: OperatorCallMarker): Promise<boolean> {
        if (this.mode === 'local') return markOperatorCallCapturePhase(targetJid, marker);
        if (this.mode !== 'agent' || !this.activeAgentCapture) return false;
        if (this.activeAgentCapture.targetJid !== targetJid) return false;
        return this.agent!.markOperatorCallCapturePhase({
            captureCallId: this.activeAgentCapture.callId,
            targetJid,
            marker,
        });
    }

    async stop(expectedCallId?: string): Promise<CallAnalysisResult | null> {
        return this.withObserverLifecycle(() => this.stopWithinObserverLifecycle(expectedCallId));
    }

    private async stopWithinObserverLifecycle(expectedCallId?: string): Promise<CallAnalysisResult | null> {
        let result: CallAnalysisResult | null = null;
        let stoppedCallId = expectedCallId;
        if (this.mode === 'local') {
            result = stopCallCapture();
            stoppedCallId ??= result?.callId;
        }
        if (this.mode === 'agent') {
            let callId = expectedCallId ?? this.activeAgentCapture?.callId;
            if (!callId) {
                const status = await this.getStatus();
                callId = status.isCapturing ? status.callId ?? undefined : undefined;
            }
            if (!callId) return null;
            stoppedCallId = callId;
            try {
                result = await this.agent!.stopCallCapture(callId);
                if (result.callId !== callId) {
                    throw new CaptureAgentClientError(
                        'Capture agent returned an analysis for a different call',
                        502,
                        'invalid_agent_response',
                    );
                }
                if (this.activeAgentCapture?.callId === callId) this.activeAgentCapture = null;
            } catch (error) {
                if (error instanceof CaptureAgentClientError && error.code === 'capture_not_active') {
                    if (this.activeAgentCapture?.callId === callId) this.activeAgentCapture = null;
                    await this.finishObserverEvidenceWithinLifecycle(callId);
                    return null;
                }
                throw error;
            }
        }
        if (!result || !stoppedCallId) return result;
        const browserWebRtcEvidence = await this.finishObserverEvidenceWithinLifecycle(stoppedCallId);
        return browserWebRtcEvidence ? { ...result, browserWebRtcEvidence } : result;
    }

    private async finishObserverEvidenceWithinLifecycle(callId: string): Promise<BrowserWebRtcEvidence | null> {
        const completed = this.completedObserverEvidence?.callId === callId
            ? this.completedObserverEvidence
            : null;
        if (completed) {
            this.completedObserverEvidence = null;
            return this.decorateObserverEvidence(completed.evidence, completed.trigger);
        }
        const active = this.activeObserverCapture;
        const failed = this.observerStartFailure?.callId === callId ? this.observerStartFailure : null;
        this.observerStartFailure = null;
        if (active?.callId === callId && this.observer) {
            this.activeObserverCapture = null;
            try {
                const evidence = await this.observer.stop(callId);
                this.observerAvailable = true;
                return this.decorateObserverEvidence(evidence, active.trigger);
            } catch {
                this.observerAvailable = false;
                return {
                    version: 1,
                    status: 'unavailable',
                    startedAt: active.startedAt,
                    endedAt: new Date(),
                    connectionCount: 0,
                    selectedPairs: [],
                    stateTransitions: [],
                    truncated: false,
                    limitations: ['browser_webrtc_observer_stop_unavailable'],
                };
            }
        }
        if (!failed) return null;
        return {
            version: 1,
            status: 'unavailable',
            startedAt: failed.startedAt,
            endedAt: new Date(),
            connectionCount: 0,
            selectedPairs: [],
            stateTransitions: [],
            truncated: false,
            limitations: [failed.limitation],
        };
    }

    private decorateObserverEvidence(
        evidence: BrowserWebRtcEvidence,
        trigger: CallCaptureStartContext['trigger'] | 'recovered',
    ): BrowserWebRtcEvidence {
        if (trigger === 'manual') return evidence;
        const lifecycleLimitation = trigger === 'auto'
            ? 'browser_webrtc_armed_after_automatic_call_signal'
            : 'browser_webrtc_observer_scope_recovered_after_backend_restart';
        return {
            ...evidence,
            limitations: [...new Set([...evidence.limitations, lifecycleLimitation])],
        };
    }

    private async reconcileObserverScope(): Promise<void> {
        if (!this.observer) return;
        await this.withObserverLifecycle(async () => {
            const captureStatus = this.mode === 'local'
                ? getCallCaptureStatus()
                : this.mode === 'agent'
                    ? await this.agent!.getCallCaptureStatus()
                    : { ...EMPTY_STATUS };
            if (this.mode === 'agent') {
                this.activeAgentCapture = captureStatus.isCapturing && captureStatus.callId && captureStatus.targetJid
                    ? { callId: captureStatus.callId, targetJid: captureStatus.targetJid }
                    : null;
            }
            let observerStatus: WebRtcObserverStatus;
            try {
                observerStatus = await this.observer!.status();
            } catch {
                this.observerAvailable = false;
                return;
            }

            const captureActive = captureStatus.isCapturing
                && captureStatus.callId !== null
                && captureStatus.targetJid !== null;
            if (!captureActive) {
                const known = this.activeObserverCapture;
                if (known) {
                    const recoverableScope = !observerStatus.active || (
                        observerStatus.callId === known.callId
                        && observerStatus.targetJid === known.targetJid
                    );
                    if (recoverableScope) {
                        try {
                            const evidence = await this.observer!.stop(known.callId);
                            this.completedObserverEvidence = {
                                callId: known.callId,
                                evidence,
                                trigger: known.trigger,
                            };
                            this.observerStartFailure = null;
                            this.observerAvailable = true;
                        } catch {
                            this.observerAvailable = false;
                            this.observerStartFailure = {
                                callId: known.callId,
                                startedAt: known.startedAt,
                                limitation: 'browser_webrtc_observer_scope_lost_during_capture',
                            };
                        }
                        this.activeObserverCapture = null;
                        return;
                    }
                    this.observerStartFailure = {
                        callId: known.callId,
                        startedAt: known.startedAt,
                        limitation: 'browser_webrtc_observer_scope_lost_during_capture',
                    };
                }
                this.activeObserverCapture = null;
                if (observerStatus.active && observerStatus.callId) {
                    try {
                        await this.observer!.stop(observerStatus.callId);
                    } catch {
                        this.observerAvailable = false;
                    }
                }
                return;
            }

            const callId = captureStatus.callId!;
            const targetJid = captureStatus.targetJid!;
            if (
                observerStatus.active
                && observerStatus.callId === callId
                && observerStatus.targetJid === targetJid
                && observerStatus.startedAt
            ) {
                if (
                    this.activeObserverCapture?.callId !== callId
                    || this.activeObserverCapture.targetJid !== targetJid
                ) {
                    this.activeObserverCapture = {
                        callId,
                        targetJid,
                        startedAt: observerStatus.startedAt,
                        trigger: 'recovered',
                    };
                }
                this.observerStartFailure = null;
                return;
            }

            if (!observerStatus.active && this.observerStartFailure?.callId !== callId) {
                const known = this.activeObserverCapture?.callId === callId
                    && this.activeObserverCapture.targetJid === targetJid
                    ? this.activeObserverCapture
                    : null;
                try {
                    const evidence = await this.observer!.stop(callId);
                    this.completedObserverEvidence = {
                        callId,
                        evidence,
                        trigger: known?.trigger ?? 'recovered',
                    };
                    this.activeObserverCapture = null;
                    this.observerStartFailure = null;
                    this.observerAvailable = true;
                    return;
                } catch {
                    // No bounded TTL result exists; continue to explicit loss handling.
                }
            }

            if (observerStatus.active && observerStatus.callId) {
                try {
                    await this.observer!.stop(observerStatus.callId);
                } catch {
                    this.observerAvailable = false;
                }
            }
            this.activeObserverCapture = null;
            if (this.observerStartFailure?.callId !== callId) {
                this.observerStartFailure = {
                    callId,
                    startedAt: captureStatus.startTime ?? new Date(),
                    limitation: 'browser_webrtc_observer_scope_lost_during_capture',
                };
            }
        });
    }

    private async withObserverLifecycle<T>(operation: () => Promise<T>): Promise<T> {
        const previous = this.observerLifecycleTail;
        let release!: () => void;
        this.observerLifecycleTail = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
            return await operation();
        } finally {
            release();
        }
    }
}
