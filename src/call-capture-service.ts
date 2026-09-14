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
import { WebRtcObserverClient, type WebRtcObserverStatus } from './webrtc-observer-client.js';
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
}

export type CallPacketCallback = (packet: unknown) => void;

export interface CallCaptureStartContext {
    trigger: 'manual' | 'auto';
    observedCallId?: string;
    initialCallStatus?: CallCapturePhaseStatus;
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
        let started = false;
        if (this.mode === 'local') {
            started = startCallCapture(interfaceAddr, targetJid, callId, isVideo, packetCallback, context);
        }
        if (this.mode === 'agent') {
            started = await this.agent!.startCallCapture({ interfaceAddr, targetJid, callId, isVideo, ...context });
            if (started) this.activeAgentCapture = { callId, targetJid };
        }
        if (!started) return false;
        this.completedObserverEvidence = null;
        this.observerStartFailure = null;
        if (this.observer) {
            const observerStartedAt = new Date();
            try {
                await this.observer.start(callId, targetJid, this.observerTtlMs);
                this.activeObserverCapture = {
                    callId,
                    targetJid,
                    startedAt: observerStartedAt,
                    trigger: context.trigger,
                };
                this.observerAvailable = true;
            } catch {
                this.activeObserverCapture = null;
                this.observerAvailable = false;
                this.observerStartFailure = {
                    callId,
                    startedAt: observerStartedAt,
                    limitation: 'browser_webrtc_observer_start_unavailable',
                };
            }
        }
        return true;
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
