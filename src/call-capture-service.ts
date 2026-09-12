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
import { WebRtcObserverClient } from './webrtc-observer-client.js';
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
        trigger: CallCaptureStartContext['trigger'];
    } | null = null;
    private observerStartFailure: { callId: string; startedAt: Date; limitation: string } | null = null;

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
        if (this.mode === 'local') return hasPacketCapturePrivileges();
        if (this.mode === 'disabled') return false;
        this.agentAvailable = await this.agent!.ready();
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
        let started = false;
        if (this.mode === 'local') {
            started = startCallCapture(interfaceAddr, targetJid, callId, isVideo, packetCallback, context);
        }
        if (this.mode === 'agent') {
            started = await this.agent!.startCallCapture({ interfaceAddr, targetJid, callId, isVideo, ...context });
            if (started) this.activeAgentCapture = { callId, targetJid };
        }
        if (!started) return false;
        const observerStartedAt = new Date();
        this.observerStartFailure = null;
        if (this.observer) {
            try {
                await this.observer.start(callId, targetJid, this.observerTtlMs);
                this.activeObserverCapture = { callId, targetJid, startedAt: observerStartedAt, trigger: context.trigger };
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
                    await this.finishObserverEvidence(callId);
                    return null;
                }
                throw error;
            }
        }
        if (!result || !stoppedCallId) return result;
        const browserWebRtcEvidence = await this.finishObserverEvidence(stoppedCallId);
        return browserWebRtcEvidence ? { ...result, browserWebRtcEvidence } : result;
    }

    private async finishObserverEvidence(callId: string): Promise<BrowserWebRtcEvidence | null> {
        const active = this.activeObserverCapture;
        const failed = this.observerStartFailure?.callId === callId ? this.observerStartFailure : null;
        this.observerStartFailure = null;
        if (active?.callId === callId && this.observer) {
            this.activeObserverCapture = null;
            try {
                const evidence = await this.observer.stop(callId);
                this.observerAvailable = true;
                if (active.trigger !== 'auto') return evidence;
                return {
                    ...evidence,
                    limitations: [...new Set([
                        ...evidence.limitations,
                        'browser_webrtc_armed_after_automatic_call_signal',
                    ])],
                };
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
}
