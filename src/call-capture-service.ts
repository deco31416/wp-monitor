import {
    autoDetectInterface,
    getCallCaptureStatus,
    startCallCapture,
    stopCallCapture,
} from './call-analyzer.js';
import type { CallAnalysisResult, CallCaptureStatus } from './call-analyzer.js';
import { CaptureAgentClient, CaptureAgentClientError } from './capture-agent-client.js';
import { hasPacketCapturePrivileges } from './capture-permissions.js';
import { listInterfaces } from './packet-capture.js';
import type { NetworkInterface } from './packet-capture.js';
import type { CallCaptureMode } from './runtime.js';

export interface CallCaptureServiceOptions {
    mode: CallCaptureMode;
    agent?: CaptureAgentClient;
}

export type CallPacketCallback = (packet: unknown) => void;

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
    private agentAvailable = false;

    constructor(options: CallCaptureServiceOptions) {
        if (options.mode === 'agent' && !options.agent) {
            throw new Error('Capture agent mode requires an initialized CaptureAgentClient');
        }
        if (options.mode !== 'agent' && options.agent) {
            throw new Error('Capture agent client is only valid in agent mode');
        }
        this.mode = options.mode;
        this.agent = options.agent ?? null;
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
        if (this.mode === 'local') return hasPacketCapturePrivileges();
        if (this.mode === 'disabled') return false;
        this.agentAvailable = await this.agent!.ready();
        return this.agentAvailable;
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
        if (this.mode === 'agent') return this.agent!.getCallCaptureStatus();
        return { ...EMPTY_STATUS };
    }

    async start(
        interfaceAddr: string,
        targetJid: string,
        callId: string,
        isVideo: boolean,
        packetCallback?: CallPacketCallback,
    ): Promise<boolean> {
        if (this.mode === 'local') {
            return startCallCapture(interfaceAddr, targetJid, callId, isVideo, packetCallback);
        }
        if (this.mode === 'agent') {
            return this.agent!.startCallCapture({ interfaceAddr, targetJid, callId, isVideo });
        }
        return false;
    }

    async stop(): Promise<CallAnalysisResult | null> {
        if (this.mode === 'local') return stopCallCapture();
        if (this.mode === 'agent') {
            try {
                return await this.agent!.stopCallCapture();
            } catch (error) {
                if (error instanceof CaptureAgentClientError && error.code === 'capture_not_active') return null;
                throw error;
            }
        }
        return null;
    }
}
