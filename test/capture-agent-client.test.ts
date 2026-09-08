import test from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createCaptureAgentApp, type CaptureAgentAdapter } from '../src/capture-agent-app.js';
import { CaptureAgentClient, CaptureAgentClientError } from '../src/capture-agent-client.js';
import { CallCaptureService } from '../src/call-capture-service.js';
import type { CallAnalysisResult, CallCaptureStatus } from '../src/call-analyzer.js';
import { CallCapturePhaseLifecycle } from '../src/call-capture-phases.js';

const SECRET = 'capture-agent-client-secret-0000000000000000000000';
const NOW = 1_787_593_200_000;

function createAdapter(): CaptureAgentAdapter {
    const phaseLifecycle = new CallCapturePhaseLifecycle(() => new Date(NOW));
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
        startCallCapture: (_interfaceAddr, targetJid, callId, _isVideo, context) => {
            status.isCapturing = true;
            status.targetJid = targetJid;
            status.callId = callId;
            status.startTime = new Date(NOW);
            phaseLifecycle.start({ captureCallId: callId, targetJid, ...context });
            return true;
        },
        observeCallCapturePhase: (targetJid, observedCallId, phaseStatus) => (
            phaseLifecycle.observe(targetJid, observedCallId, phaseStatus)
        ),
        stopCallCapture: () => {
            if (!status.isCapturing) return null;
            const capturePhases = phaseLifecycle.finish(
                status.callId!,
                status.targetJid!,
                new Date(NOW + 10_000),
            );
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
                ...(capturePhases ? { schemaVersion: 2, capturePhases } : {}),
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
            trigger: 'manual',
        }), true);

        const active = await client.getCallCaptureStatus();
        assert.equal(active.isCapturing, true);
        assert.ok(active.startTime instanceof Date);
        assert.equal(await client.observeCallCapturePhase({
            captureCallId: 'CALL-REMOTE-001',
            targetJid: '573001112233@s.whatsapp.net',
            observedCallId: 'OBSERVED-CALL-001',
            status: 'offer',
        }), true);

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

test('call capture service forwards the signed remote phase lifecycle', async () => {
    await withAgent(async baseUrl => {
        let nonce = 0;
        const client = new CaptureAgentClient({
            baseUrl,
            sharedSecret: SECRET,
            now: () => NOW,
            nonce: () => `service_nonce_${String(++nonce).padStart(16, '0')}`,
        });
        const service = new CallCaptureService({ mode: 'agent', agent: client });
        const targetJid = '573001112233@s.whatsapp.net';

        assert.equal(await service.start(
            '172.31.0.10',
            targetJid,
            'CAPTURE-SERVICE-001',
            false,
            undefined,
            { trigger: 'manual' },
        ), true);
        assert.equal(await service.observeCallEvent(targetJid, 'OBSERVED-SERVICE-001', 'offer'), true);
        assert.equal(await service.observeCallEvent(targetJid, 'OBSERVED-SERVICE-001', 'accept'), true);
        assert.equal(await service.observeCallEvent(targetJid, 'OBSERVED-SERVICE-001', 'terminate'), true);

        const result = await service.stop();
        assert.equal(result?.capturePhases?.negotiationStartedAt?.getTime(), NOW);
        assert.equal(result?.capturePhases?.activeCallStartedAt?.getTime(), NOW);
        assert.equal(result?.capturePhases?.baselineAvailable, false);
        assert.equal(await service.observeCallEvent(targetJid, 'OBSERVED-SERVICE-001', 'accept'), false);
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

test('readiness requires the remote phase capability', async () => {
    const client = new CaptureAgentClient({
        baseUrl: 'http://capture-agent.test:4100',
        sharedSecret: SECRET,
        fetchImpl: (async () => new Response(JSON.stringify({
            status: 'ready',
            capturePrivileges: true,
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });

    assert.equal(await client.ready(), false);
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

test('call phase requests fail closed on timeout, unavailable agent, and oversized response', async () => {
    const phase = {
        captureCallId: 'CAPTURE-FAILURE-001',
        targetJid: '573001112233@s.whatsapp.net',
        observedCallId: 'OBSERVED-FAILURE-001',
        status: 'offer' as const,
    };
    const unavailable = new CaptureAgentClient({
        baseUrl: 'http://127.0.0.1:9',
        sharedSecret: SECRET,
        timeoutMs: 500,
    });
    await assert.rejects(
        unavailable.observeCallCapturePhase(phase),
        (error: unknown) => error instanceof CaptureAgentClientError
            && error.code === 'capture_agent_unavailable',
    );

    const timedOut = new CaptureAgentClient({
        baseUrl: 'http://capture-agent.test:4100',
        sharedSecret: SECRET,
        timeoutMs: 500,
        fetchImpl: ((_input, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        })) as typeof fetch,
    });
    await assert.rejects(
        timedOut.observeCallCapturePhase(phase),
        (error: unknown) => error instanceof CaptureAgentClientError
            && error.code === 'capture_agent_unavailable',
    );

    const oversized = new CaptureAgentClient({
        baseUrl: 'http://capture-agent.test:4100',
        sharedSecret: SECRET,
        fetchImpl: (async () => new Response('{}', {
            status: 200,
            headers: { 'content-length': String(5 * 1024 * 1024 + 1) },
        })) as typeof fetch,
    });
    await assert.rejects(
        oversized.observeCallCapturePhase(phase),
        (error: unknown) => error instanceof CaptureAgentClientError
            && error.code === 'agent_response_too_large',
    );

    const inconsistent = new CaptureAgentClient({
        baseUrl: 'http://capture-agent.test:4100',
        sharedSecret: SECRET,
        fetchImpl: (async () => new Response(JSON.stringify({
            ok: true,
            captureCallId: phase.captureCallId,
            observedCallId: 'OBSERVED-OTHER-001',
            status: phase.status,
        }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });
    await assert.rejects(
        inconsistent.observeCallCapturePhase(phase),
        (error: unknown) => error instanceof CaptureAgentClientError
            && error.code === 'invalid_agent_response',
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

test('capture agent client accepts the additive v2 packet contract without requiring it from legacy results', async () => {
    const payload = {
        callId: 'CALL-V2-001',
        targetJid: '573001112233@s.whatsapp.net',
        startTime: new Date(NOW).toISOString(),
        endTime: new Date(NOW + 10_000).toISOString(),
        durationSec: 10,
        isVideo: false,
        totalPackets: 12,
        candidateIps: [{
            ip: '2001:db8::20',
            packets: 8,
            bytesTotal: 960,
            firstSeen: new Date(NOW + 5_000).toISOString(),
            lastSeen: new Date(NOW + 9_000).toISOString(),
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
                caution: 'Synthetic test fixture.',
                registryEvidence: {
                    schemaVersion: 1,
                    registryVersion: 'test.1',
                    registryPublishedAt: new Date(NOW).toISOString(),
                    status: 'fresh',
                    entryId: 'synthetic-ipv6',
                    matchedCidr: '2001:db8::/32',
                    provider: 'unknown',
                    category: 'cloud_hosting',
                    endpointRole: 'cloud_hosting',
                    asn: 64_512,
                    org: 'Synthetic ISP',
                    source: {
                        id: 'synthetic-source',
                        label: 'Synthetic registry source',
                        uri: null,
                        kind: 'observed_heuristic',
                        retrievedAt: new Date(NOW).toISOString(),
                        validUntil: new Date(NOW + 86_400_000).toISOString(),
                    },
                    competingEntryIds: [],
                    degraded: false,
                    caution: 'Synthetic test fixture; no identity claim.',
                },
            },
            geo: null,
            confidence: 'low',
            confidenceScore: 15,
            reasonCodes: [],
            technicalNote: 'Synthetic v2 candidate.',
            isP2P: false,
            addressFamily: 6,
            endpointRole: 'unknown',
            baselinePackets: 2,
            activeCallPackets: 6,
            protocolEvidence: ['stun_binding_request', 'transport_flow'],
            scoreVersion: 2,
        }],
        metaIps: ['2a03:2880::1'],
        verdict: 'insufficient_data',
        captureInterface: '172.31.0.10',
        schemaVersion: 2,
        capturePhases: {
            baselineAvailable: true,
            baselineStartedAt: new Date(NOW).toISOString(),
            baselineEndedAt: new Date(NOW + 2_000).toISOString(),
            negotiationStartedAt: new Date(NOW + 3_000).toISOString(),
            activeCallStartedAt: new Date(NOW + 5_000).toISOString(),
        },
        captureBounds: {
            packetLimit: 50_000,
            storedPackets: 10,
            droppedPackets: 2,
            truncated: true,
        },
    };
    const client = new CaptureAgentClient({
        baseUrl: 'http://capture-agent.test:4100',
        sharedSecret: SECRET,
        fetchImpl: (async () => new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        })) as typeof fetch,
    });

    const result = await client.stopCallCapture();
    assert.equal(result.schemaVersion, 2);
    assert.equal(result.candidateIps[0]?.addressFamily, 6);
    assert.equal(result.candidateIps[0]?.endpointRole, 'unknown');
    assert.equal(result.candidateIps[0]?.networkIntelligence?.registryEvidence?.registryVersion, 'test.1');
    assert.equal(result.candidateIps[0]?.networkIntelligence?.registryEvidence?.source?.label, 'Synthetic registry source');
    assert.deepEqual(result.candidateIps[0]?.protocolEvidence, ['stun_binding_request', 'transport_flow']);
    assert.ok(result.capturePhases?.baselineStartedAt instanceof Date);
    assert.equal(result.capturePhases?.baselineAvailable, true);
    assert.deepEqual(result.captureBounds, {
        packetLimit: 50_000,
        storedPackets: 10,
        droppedPackets: 2,
        truncated: true,
    });

    for (const candidateIps of [
        [{ ...payload.candidateIps[0], activeCallPackets: undefined }],
        [{ ...payload.candidateIps[0], baselinePackets: 3, activeCallPackets: 6 }],
    ]) {
        const invalidClient = new CaptureAgentClient({
            baseUrl: 'http://capture-agent.test:4100',
            sharedSecret: SECRET,
            fetchImpl: (async () => new Response(JSON.stringify({ ...payload, candidateIps }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as typeof fetch,
        });
        await assert.rejects(
            invalidClient.stopCallCapture(),
            (error: unknown) => error instanceof CaptureAgentClientError
                && error.code === 'invalid_agent_response',
        );
    }
});

test('capture agent client rejects inconsistent v2 evidence and backend-owned conclusions', async () => {
    const basePayload = {
        callId: 'CALL-V2-002',
        targetJid: '573001112233@s.whatsapp.net',
        startTime: new Date(NOW).toISOString(),
        endTime: new Date(NOW + 10_000).toISOString(),
        durationSec: 10,
        isVideo: false,
        totalPackets: 0,
        candidateIps: [],
        metaIps: [],
        verdict: 'insufficient_data',
        captureInterface: '172.31.0.10',
        schemaVersion: 2,
    };
    const payloads = [
        {
            ...basePayload,
            capturePhases: {
                baselineAvailable: true,
                baselineStartedAt: null,
                baselineEndedAt: null,
                negotiationStartedAt: null,
                activeCallStartedAt: null,
            },
        },
        {
            ...basePayload,
            capturePhases: {
                baselineAvailable: false,
                baselineStartedAt: null,
                baselineEndedAt: null,
                negotiationStartedAt: null,
                activeCallStartedAt: new Date(NOW + 5_000).toISOString(),
            },
        },
        {
            ...basePayload,
            capturePhases: {
                baselineAvailable: true,
                baselineStartedAt: new Date(NOW - 1_000).toISOString(),
                baselineEndedAt: new Date(NOW + 1_000).toISOString(),
                negotiationStartedAt: new Date(NOW + 1_000).toISOString(),
                activeCallStartedAt: null,
            },
        },
        {
            ...basePayload,
            capturePhases: {
                baselineAvailable: false,
                baselineStartedAt: null,
                baselineEndedAt: null,
                negotiationStartedAt: new Date(NOW + 11_000).toISOString(),
                activeCallStartedAt: null,
            },
        },
        {
            ...basePayload,
            routeAssessment: {
                classification: 'direct_confirmed',
                confidenceScore: 100,
                evidenceSources: ['packet_flow'],
                limitations: [],
            },
        },
        {
            ...basePayload,
            totalPackets: 2,
            captureBounds: {
                packetLimit: 50_000,
                storedPackets: 1,
                droppedPackets: 0,
                truncated: false,
            },
        },
        {
            ...basePayload,
            totalPackets: 1,
            captureBounds: {
                packetLimit: 50_000,
                storedPackets: 0,
                droppedPackets: 1,
                truncated: false,
            },
        },
    ];

    for (const payload of payloads) {
        const client = new CaptureAgentClient({
            baseUrl: 'http://capture-agent.test:4100',
            sharedSecret: SECRET,
            fetchImpl: (async () => new Response(JSON.stringify(payload), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as typeof fetch,
        });
        await assert.rejects(
            client.stopCallCapture(),
            (error: unknown) => error instanceof CaptureAgentClientError
                && error.code === 'invalid_agent_response',
        );
    }
});
