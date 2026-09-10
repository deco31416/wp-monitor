import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type {
    CallAnalysisResult,
    CallEndpointRole,
    CandidateIP,
} from '../src/call-analyzer.js';
import { CallCapturePhaseLifecycle } from '../src/call-capture-phases.js';
import type {
    CandidateProvider,
    NetworkCategory,
    NetworkIntelligenceCategory,
} from '../src/call-scoring.js';
import { correlateCallRoute } from '../src/call-route-correlator.js';

interface SanitizedEndpointFixture {
    ip: string;
    provider: CandidateProvider;
    category: NetworkCategory;
    role: CallEndpointRole;
    packets: number;
}

interface E4CorrelationFixture {
    schemaVersion: 1;
    scenario: string;
    provenance: string;
    capture: {
        captureCallId: string;
        targetJid: string;
        startedAt: string;
        endedAt: string;
        durationSec: number;
        totalPackets: number;
    };
    observations: {
        operatorObservedWebCall: boolean;
        backendCallStatuses: string[];
        correlatedCallStart: boolean;
    };
    endpoints: SanitizedEndpointFixture[];
    expected: {
        metaEndpointCount: number;
        otherInfrastructureEndpointCount: number;
        baselinePackets: number;
        activeCallPackets: number;
        classification: 'unresolved';
        confidenceScore: number;
        primaryCandidateIp: null;
    };
}

const fixture = JSON.parse(readFileSync(
    new URL('./fixtures/e4-web-call-without-correlated-start.json', import.meta.url),
    'utf8',
)) as E4CorrelationFixture;

function buildInfrastructureCandidate(
    endpoint: SanitizedEndpointFixture,
    startedAt: Date,
    endedAt: Date,
): CandidateIP {
    const intelligenceCategory = endpoint.category as NetworkIntelligenceCategory;
    return {
        ip: endpoint.ip,
        packets: endpoint.packets,
        bytesTotal: endpoint.packets * 240,
        firstSeen: startedAt,
        lastSeen: endedAt,
        avgSize: 240,
        ports: endpoint.role === 'stun_turn' ? [3478] : [443],
        direction: 'bidirectional',
        provider: endpoint.provider,
        networkCategory: endpoint.category,
        networkIntelligence: {
            asn: endpoint.provider === 'meta' ? 32934 : 15169,
            org: endpoint.provider === 'meta' ? 'Synthetic Meta infrastructure' : 'Synthetic Google infrastructure',
            category: intelligenceCategory,
            source: 'local_rules',
            isDatacenterLikely: true,
            caution: 'Sanitized E4 regression fixture; infrastructure only.',
            registryEvidence: {
                schemaVersion: 1,
                registryVersion: 'synthetic-e4-regression',
                registryPublishedAt: '2026-09-09T00:00:00.000Z',
                status: 'fresh',
                entryId: `synthetic-${endpoint.provider}-${endpoint.role}`,
                matchedCidr: null,
                provider: endpoint.provider,
                category: endpoint.category === 'meta' ? 'meta' : 'stun_turn',
                endpointRole: endpoint.role === 'relay' ? 'relay' : 'stun_turn',
                asn: endpoint.provider === 'meta' ? 32934 : 15169,
                org: endpoint.provider === 'meta' ? 'Synthetic Meta infrastructure' : 'Synthetic Google infrastructure',
                source: null,
                competingEntryIds: [],
                degraded: false,
                caution: 'Synthetic registry evidence.',
            },
        },
        geo: null,
        confidence: 'low',
        confidenceScore: 0,
        reasonCodes: [],
        technicalNote: 'Sanitized infrastructure observation.',
        isP2P: false,
        endpointRole: endpoint.role,
        protocolEvidence: endpoint.role === 'stun_turn' ? ['stun_other'] : ['transport_flow'],
        baselinePackets: endpoint.packets,
        activeCallPackets: 0,
        scoreVersion: 2,
    };
}

test('reproduces the authorized E4 Web call that ended without a correlated call phase', () => {
    const startedAt = new Date(fixture.capture.startedAt);
    const endedAt = new Date(fixture.capture.endedAt);
    let now = startedAt;
    const lifecycle = new CallCapturePhaseLifecycle(() => now);

    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.observations.operatorObservedWebCall, true);
    assert.deepEqual(fixture.observations.backendCallStatuses, []);
    assert.equal(fixture.observations.correlatedCallStart, false);
    assert.equal(lifecycle.start({
        captureCallId: fixture.capture.captureCallId,
        targetJid: fixture.capture.targetJid,
        trigger: 'manual',
    }), true);

    now = endedAt;
    const capturePhases = lifecycle.finish(
        fixture.capture.captureCallId,
        fixture.capture.targetJid,
        endedAt,
    );
    assert.ok(capturePhases);
    assert.equal(capturePhases.baselineAvailable, true);
    assert.equal(capturePhases.baselineEndedAt?.getTime(), endedAt.getTime());
    assert.equal(capturePhases.negotiationStartedAt, null);
    assert.equal(capturePhases.activeCallStartedAt, null);

    const candidateIps = fixture.endpoints.map(endpoint => (
        buildInfrastructureCandidate(endpoint, startedAt, endedAt)
    ));
    const metaIps = fixture.endpoints
        .filter(endpoint => endpoint.provider === 'meta')
        .map(endpoint => endpoint.ip);
    const result: CallAnalysisResult = {
        callId: fixture.capture.captureCallId,
        targetJid: fixture.capture.targetJid,
        startTime: startedAt,
        endTime: endedAt,
        durationSec: fixture.capture.durationSec,
        isVideo: false,
        totalPackets: fixture.capture.totalPackets,
        candidateIps,
        metaIps,
        verdict: 'insufficient_data',
        captureInterface: '192.0.2.200',
        schemaVersion: 2,
        capturePhases,
        stunEndpoints: [{
            ip: '198.51.100.21',
            port: 3478,
            addressFamily: 4,
            role: 'stun_turn',
            source: 'stun',
        }],
        captureBounds: {
            packetLimit: 50_000,
            storedPackets: fixture.capture.totalPackets,
            droppedPackets: 0,
            truncated: false,
        },
    };

    assert.equal(candidateIps.reduce((sum, endpoint) => sum + endpoint.packets, 0), fixture.capture.totalPackets);
    assert.equal(candidateIps.reduce((sum, endpoint) => sum + (endpoint.baselinePackets ?? 0), 0), fixture.expected.baselinePackets);
    assert.equal(candidateIps.reduce((sum, endpoint) => sum + (endpoint.activeCallPackets ?? 0), 0), fixture.expected.activeCallPackets);
    assert.equal(metaIps.length, fixture.expected.metaEndpointCount);
    assert.equal(candidateIps.length - metaIps.length, fixture.expected.otherInfrastructureEndpointCount);

    const assessed = correlateCallRoute(result);
    assert.equal(assessed.routeAssessment?.classification, fixture.expected.classification);
    assert.equal(assessed.routeAssessment?.confidenceScore, fixture.expected.confidenceScore);
    assert.equal(assessed.routeAssessment?.primaryCandidateIp, fixture.expected.primaryCandidateIp);
    assert.equal(assessed.routeAssessment?.independentDirectEvidenceCount, 0);
    assert.ok(assessed.routeAssessment?.evidenceSources.includes('packet_flow'));
    assert.ok(assessed.routeAssessment?.evidenceSources.includes('baseline'));
    assert.ok(assessed.routeAssessment?.evidenceSources.includes('stun'));
    assert.ok(assessed.routeAssessment?.evidenceSources.includes('infrastructure_registry'));
    assert.ok(assessed.routeAssessment?.reasonCodes.includes('NO_CONCLUSIVE_ROUTE_EVIDENCE'));
    assert.ok(assessed.routeAssessment?.reasonCodes.includes('STUN_CONTEXT_ONLY'));
    assert.ok(assessed.routeAssessment?.limitations.includes('no_eligible_direct_candidate'));
    assert.equal(assessed.verdict, 'insufficient_data');
});
