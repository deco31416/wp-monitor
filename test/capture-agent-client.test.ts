import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCaptureAgentApp, type CaptureAgentAdapter } from '../src/capture-agent-app.js';
import { CaptureAgentClient, CaptureAgentClientError } from '../src/capture-agent-client.js';
import { CallCaptureService } from '../src/call-capture-service.js';
import type { CallAnalysisResult, CallCaptureStatus } from '../src/call-analyzer.js';

const SECRET = 'capture-agent-client-secret-0000000000000000000000';
const NOW = 1_787_593_200_000;

function createAdapter(): CaptureAgentAdapter {
    const status: CallCaptureStatus = {
        isCapturing: false,
        targetJid: null,
        callId: null,
        startTime: null,
        packetsCollected: 0,
        elapsed: 0,
    };
    return {
        capturePrivilegesAvailable: () => true,
        listInterfaces: () => [{ name: 'browser-net', address: '172.31.0.10', description: 'Browser namespace' }],
        getCallCaptureStatus: () => ({ ...status }),
        startCallCapture: (_interfaceAddr, targetJid, callId) => {
            status.isCapturing = true;
            status.targetJid = targetJid;
            status.callId = callId;
            status.startTime = new Date(NOW);
            return true;
        },
        stopCallCapture: () => {
            if (!status.isCapturing) return null;
            const result: CallAnalysisResult = {
                callId: status.callId!,
                targetJid: status.targetJid!,
                startTime: status.startTime!,
                endTime: new Date(NOW + 10_000),
                durationSec: 10,
                isVideo: false,
                totalPackets: 12,
                candidateIps: [{
                    ip: '198.51.100.20',
                    packets: 6,
                    bytesTotal: 720,
                    firstSeen: new Date(NOW),
                    lastSeen: new Date(NOW + 4_000),
                    avgSize: 120,
                    ports: [40_000, 40_001],
                    direction: 'bidirectional',
                    provider: 'unknown',
                    networkCategory: 'consumer_isp_or_unknown',
                    networkIntelligence: {
                        asn: 64_512,
                        org: 'Synthetic ISP',
                        category: 'consumer_isp_or_unknown',
                        source: 'local_rules',
                        isDatacenterLikely: false,
                        caution: 'Synthetic test fixture; no identity claim.',
                    },
                    geo: null,
                    confidence: 'low',
                    confidenceScore: 15,
                    reasonCodes: [{ code: 'SYNTHETIC', label: 'Synthetic fixture', delta: 0 }],
                    technicalNote: 'Synthetic candidate used only for contract validation.',
                    isP2P: false,
                    correlation: {
                        classification: 'insufficient',
                        label: 'Insufficient sample',
                        summary: 'Synthetic fixture with bounded evidence.',
                        phoneCountryCode: null,
                        observedCountryCode: null,
                        caps: ['Synthetic fixture'],
                    },
                }],
                metaIps: ['157.240.1.1'],
                verdict: 'relay',
                captureInterface: '172.31.0.10',
            };
            status.isCapturing = false;
            return result;
        },
    };
}

async function withAgent(run: (baseUrl: string) => Promise<void>): Promise<void> {
    const app = createCaptureAgentApp({ sharedSecret: SECRET, adapter: createAdapter(), now: () => NOW });
    const server: Server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    try {
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

test('capture agent client completes the authenticated lifecycle and restores Date values', async () => {
    await withAgent(async baseUrl => {
        let nonce = 0;
        const client = new CaptureAgentClient({
            baseUrl,
            sharedSecret: SECRET,
            now: () => NOW,
            nonce: () => `client_nonce_${String(++nonce).padStart(16, '0')}`,
        });

        assert.equal(await client.ready(), true);
        assert.deepEqual(await client.listInterfaces(), [
            { name: 'browser-net', address: '172.31.0.10', description: 'Browser namespace' },
        ]);
        assert.equal((await client.getCallCaptureStatus()).isCapturing, false);
        assert.equal(await client.startCallCapture({
            interfaceAddr: '172.31.0.10',
            targetJid: '573001112233@s.whatsapp.net',
            callId: 'CALL-REMOTE-001',
            isVideo: false,
        }), true);

        const active = await client.getCallCaptureStatus();
        assert.equal(active.isCapturing, true);
        assert.ok(active.startTime instanceof Date);

        const result = await client.stopCallCapture();
        assert.equal(result.callId, 'CALL-REMOTE-001');
        assert.equal(result.verdict, 'relay');
        assert.ok(result.startTime instanceof Date);
        assert.ok(result.endTime instanceof Date);
        assert.ok(result.candidateIps[0]?.firstSeen instanceof Date);
        assert.deepEqual(result.candidateIps[0]?.ports, [40_000, 40_001]);

        const service = new CallCaptureService({ mode: 'agent', agent: client });
        assert.equal(await service.stop(), null);
    });
});

test('capture agent client rejects unsafe origins and weak secrets', () => {
    assert.throws(() => new CaptureAgentClient({
        baseUrl: 'http://user:password@capture-agent:4100/path',
        sharedSecret: SECRET,
    }), /HTTP\(S\) origin/);
    assert.throws(() => new CaptureAgentClient({
        baseUrl: 'http://capture-agent:4100',
        sharedSecret: 'weak',
    }), /at least 32 bytes/);
});

test('capture agent client maps transport failures to a controlled unavailable error', async () => {
    const client = new CaptureAgentClient({
        baseUrl: 'http://127.0.0.1:9',
        sharedSecret: SECRET,
        timeoutMs: 500,
    });

    await assert.rejects(
        client.getCallCaptureStatus(),
        (error: unknown) => error instanceof CaptureAgentClientError
            && error.status === 503
            && error.code === 'capture_agent_unavailable',
    );
});

test('capture agent client rejects oversized and semantically invalid responses', async () => {
    const oversized = new CaptureAgentClient({
        baseUrl: 'http://capture-agent.test:4100',
        sharedSecret: SECRET,
        fetchImpl: (async () => new Response('{}', {
            status: 200,
            headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
        })) as typeof fetch,
    });
    await assert.rejects(
        oversized.getCallCaptureStatus(),
        (error: unknown) => error instanceof CaptureAgentClientError
            && error.code === 'agent_response_too_large',
    );

    const invalidAnalysis = new CaptureAgentClient({
        baseUrl: 'http://capture-agent.test:4100',
        sharedSecret: SECRET,
        fetchImpl: (async () => new Response(JSON.stringify({
            callId: 'CALL-001',
            targetJid: '573001112233@s.whatsapp.net',
            startTime: new Date(NOW).toISOString(),
            endTime: new Date(NOW + 1_000).toISOString(),
            durationSec: 1,
            isVideo: false,
            totalPackets: 1,
            candidateIps: [{
                ip: 'not-an-ip',
                packets: 1,
                bytesTotal: 100,
                firstSeen: new Date(NOW).toISOString(),
                lastSeen: new Date(NOW + 1_000).toISOString(),
            }],
            metaIps: [],
            verdict: 'p2p',
            captureInterface: '172.31.0.10',
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });
    await assert.rejects(
        invalidAnalysis.stopCallCapture(),
        (error: unknown) => error instanceof CaptureAgentClientError
            && error.code === 'invalid_agent_response',
    );

    const invalidNestedCandidate = new CaptureAgentClient({
        baseUrl: 'http://capture-agent.test:4100',
        sharedSecret: SECRET,
        fetchImpl: (async () => new Response(JSON.stringify({
            callId: 'CALL-002',
            targetJid: '573001112233@s.whatsapp.net',
            startTime: new Date(NOW).toISOString(),
            endTime: new Date(NOW + 1_000).toISOString(),
            durationSec: 1,
            isVideo: false,
            totalPackets: 1,
            candidateIps: [{
                ip: '198.51.100.21',
                packets: 1,
                bytesTotal: 100,
                firstSeen: new Date(NOW).toISOString(),
                lastSeen: new Date(NOW + 1_000).toISOString(),
                avgSize: 100,
                ports: [70_000],
                direction: 'bidirectional',
                provider: 'unknown',
                networkCategory: 'unknown_public',
                networkIntelligence: {
                    asn: null,
                    org: 'Synthetic network',
                    category: 'unknown',
                    source: 'local_rules',
                    isDatacenterLikely: false,
                    caution: 'Synthetic fixture.',
                },
                geo: null,
                confidence: 'low',
                confidenceScore: 15,
                reasonCodes: [],
                technicalNote: 'Synthetic fixture.',
                isP2P: false,
            }],
            metaIps: [],
            verdict: 'insufficient_data',
            captureInterface: '172.31.0.10',
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });
    await assert.rejects(
        invalidNestedCandidate.stopCallCapture(),
        (error: unknown) => error instanceof CaptureAgentClientError
            && error.code === 'invalid_agent_response',
    );
});
