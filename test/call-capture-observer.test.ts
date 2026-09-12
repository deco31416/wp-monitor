import assert from 'node:assert/strict';
import test from 'node:test';
import type { CallAnalysisResult } from '../src/call-analyzer.js';
import { CallCaptureService } from '../src/call-capture-service.js';
import { CaptureAgentClient, CaptureAgentClientError } from '../src/capture-agent-client.js';
import type { BrowserWebRtcEvidence } from '../src/call-observation-evidence.js';
import { WebRtcObserverClient } from '../src/webrtc-observer-client.js';

const targetJid = '573001112233@s.whatsapp.net';
const callId = 'CALL-OBSERVER-001';

function analysis(): CallAnalysisResult {
    return {
        callId,
        targetJid,
        startTime: new Date('2026-09-11T12:00:00.000Z'),
        endTime: new Date('2026-09-11T12:01:00.000Z'),
        durationSec: 60,
        isVideo: false,
        totalPackets: 0,
        candidateIps: [],
        metaIps: [],
        verdict: 'insufficient_data',
        captureInterface: '192.0.2.10',
    };
}

function browserEvidence(): BrowserWebRtcEvidence {
    return {
        version: 1,
        status: 'available',
        startedAt: new Date('2026-09-11T12:00:00.000Z'),
        endedAt: new Date('2026-09-11T12:01:00.000Z'),
        connectionCount: 0,
        selectedPairs: [],
        stateTransitions: [],
        truncated: false,
        limitations: [],
    };
}

function agent(stop: () => Promise<CallAnalysisResult> = async () => analysis()): CaptureAgentClient {
    return {
        ready: async () => true,
        listInterfaces: async () => [],
        getCallCaptureStatus: async () => ({
            isCapturing: false, targetJid: null, callId: null, startTime: null, packetsCollected: 0, elapsed: 0,
        }),
        startCallCapture: async () => true,
        observeCallCapturePhase: async () => true,
        markOperatorCallCapturePhase: async () => true,
        stopCallCapture: stop,
    } as unknown as CaptureAgentClient;
}

function observer(options: { startFails?: boolean; stopCalls?: string[] } = {}): WebRtcObserverClient {
    return {
        ready: async () => true,
        start: async () => {
            if (options.startFails) throw new Error('synthetic observer failure');
        },
        stop: async (requestedCallId: string) => {
            options.stopCalls?.push(requestedCallId);
            return browserEvidence();
        },
        status: async () => ({ active: false, callId: null, targetJid: null, startedAt: null }),
    } as unknown as WebRtcObserverClient;
}

test('manual capture attaches browser evidence without changing the packet capture lifecycle', async () => {
    const service = new CallCaptureService({ mode: 'agent', agent: agent(), observer: observer() });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false, undefined, { trigger: 'manual' }), true);
    const result = await service.stop(callId);
    assert.equal(result?.browserWebRtcEvidence?.status, 'available');
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, []);
});

test('automatic capture declares that browser observation may start after the first call signal', async () => {
    const service = new CallCaptureService({ mode: 'agent', agent: agent(), observer: observer() });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false, undefined, {
        trigger: 'auto',
        observedCallId: 'OBSERVED-CALL-001',
        initialCallStatus: 'offer',
    }), true);
    const result = await service.stop(callId);
    assert.ok(result?.browserWebRtcEvidence?.limitations.includes('browser_webrtc_armed_after_automatic_call_signal'));
});

test('observer start failure degrades explicitly while packet capture still completes', async () => {
    const service = new CallCaptureService({
        mode: 'agent',
        agent: agent(),
        observer: observer({ startFails: true }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);
    const result = await service.stop(callId);
    assert.equal(result?.browserWebRtcEvidence?.status, 'unavailable');
    assert.deepEqual(result?.browserWebRtcEvidence?.limitations, ['browser_webrtc_observer_start_unavailable']);
});

test('capture-not-active reconciliation disarms the matching browser observer scope', async () => {
    const stopCalls: string[] = [];
    const unavailableAgent = agent(async () => {
        throw new CaptureAgentClientError('Synthetic capture already closed', 409, 'capture_not_active');
    });
    const service = new CallCaptureService({
        mode: 'agent',
        agent: unavailableAgent,
        observer: observer({ stopCalls }),
    });
    assert.equal(await service.start('192.0.2.10', targetJid, callId, false), true);
    assert.equal(await service.stop(callId), null);
    assert.deepEqual(stopCalls, [callId]);
});
