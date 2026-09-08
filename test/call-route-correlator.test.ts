import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateCallRoute } from '../src/call-route-correlator.js';
import type { CallAnalysisResult, CandidateIP } from '../src/call-analyzer.js';

function candidate(overrides: Partial<CandidateIP> = {}): CandidateIP {
    return {
        ip: '198.51.100.40',
        packets: 120,
        bytesTotal: 24_000,
        firstSeen: new Date('2026-09-08T12:00:01.000Z'),
        lastSeen: new Date('2026-09-08T12:00:20.000Z'),
        avgSize: 200,
        ports: [40_000],
        direction: 'bidirectional',
        provider: 'unknown',
        networkCategory: 'consumer_isp_or_unknown',
        networkIntelligence: {
            asn: null,
            org: 'Unknown public network',
            category: 'consumer_isp_or_unknown',
            source: 'local_rules',
            isDatacenterLikely: false,
            caution: 'Synthetic candidate',
        },
        geo: null,
        confidence: 'medium',
        confidenceScore: 62,
        reasonCodes: [],
        technicalNote: 'Synthetic candidate',
        isP2P: true,
        endpointRole: 'unknown',
        activeCallPackets: 100,
        baselinePackets: 20,
        scoreVersion: 2,
        ...overrides,
    };
}

function result(overrides: Partial<CallAnalysisResult> = {}): CallAnalysisResult {
    return {
        callId: 'CALL-ROUTE-001',
        targetJid: '573001112233@s.whatsapp.net',
        startTime: new Date('2026-09-08T12:00:00.000Z'),
        endTime: new Date('2026-09-08T12:00:30.000Z'),
        durationSec: 30,
        isVideo: false,
        totalPackets: 120,
        candidateIps: [],
        metaIps: [],
        verdict: 'insufficient_data',
        captureInterface: '192.0.2.10',
        schemaVersion: 2,
        capturePhases: {
            baselineAvailable: true,
            baselineStartedAt: new Date('2026-09-08T12:00:00.000Z'),
            baselineEndedAt: new Date('2026-09-08T12:00:05.000Z'),
            negotiationStartedAt: new Date('2026-09-08T12:00:06.000Z'),
            activeCallStartedAt: new Date('2026-09-08T12:00:08.000Z'),
        },
        ...overrides,
    };
}

function transport(ip: string, role: 'peer_candidate' | 'relay' = 'peer_candidate') {
    return {
        firstObservedAt: new Date('2026-09-08T12:00:06.000Z'),
        lastObservedAt: new Date('2026-09-08T12:00:10.000Z'),
        peerNegotiationObserved: role === 'peer_candidate',
        relayNegotiationObserved: role === 'relay',
        keepaliveObserved: false,
        candidateRounds: [1],
        endpoints: [{
            ip,
            port: 40_000,
            addressFamily: 4 as const,
            role,
            source: 'baileys_transport' as const,
        }],
        limitations: [],
    };
}

test('keeps a strong packet route probable when it has only one independent source', () => {
    const assessed = correlateCallRoute(result({ candidateIps: [candidate()] }));
    assert.equal(assessed.routeAssessment?.classification, 'direct_probable');
    assert.equal(assessed.routeAssessment?.independentDirectEvidenceCount, 1);
    assert.equal(assessed.routeAssessment?.primaryCandidateIp, '198.51.100.40');
    assert.equal(assessed.verdict, 'p2p');
});

test('confirms a direct route only when packet flow matches a Baileys peer endpoint', () => {
    const assessed = correlateCallRoute(result({
        candidateIps: [candidate()],
        transportEvidence: transport('198.51.100.40'),
    }));
    assert.equal(assessed.routeAssessment?.classification, 'direct_confirmed');
    assert.equal(assessed.routeAssessment?.independentDirectEvidenceCount, 2);
    assert.deepEqual(assessed.routeAssessment?.evidenceSources.slice(0, 2), ['packet_flow', 'baileys_transport']);
    assert.ok(assessed.routeAssessment?.confidenceScore && assessed.routeAssessment.confidenceScore >= 75);
});

test('classifies relay-only and mixed paths without promoting relay IPs to direct candidates', () => {
    const meta = candidate({
        ip: '57.144.85.57',
        provider: 'meta',
        networkCategory: 'meta',
        endpointRole: 'relay',
        isP2P: false,
        confidenceScore: 0,
        networkIntelligence: {
            asn: 32934,
            org: 'Meta',
            category: 'meta',
            source: 'local_rules',
            isDatacenterLikely: true,
            caution: 'Relay',
        },
    });
    const relay = correlateCallRoute(result({ candidateIps: [meta], metaIps: [meta.ip] }));
    assert.equal(relay.routeAssessment?.classification, 'relay_confirmed');
    assert.equal(relay.routeAssessment?.primaryCandidateIp, null);
    assert.equal(relay.verdict, 'relay');

    const mixed = correlateCallRoute(result({
        candidateIps: [candidate(), meta],
        metaIps: [meta.ip],
        transportEvidence: transport('198.51.100.40'),
    }));
    assert.equal(mixed.routeAssessment?.classification, 'mixed');
    assert.equal(mixed.routeAssessment?.independentDirectEvidenceCount, 2);
    assert.equal(mixed.verdict, 'mixed');
});

test('treats an exact STUN peer match as corroboration, not independent confirmation', () => {
    const assessed = correlateCallRoute(result({
        candidateIps: [candidate()],
        stunEndpoints: [{
            ip: '198.51.100.40',
            port: 40_000,
            addressFamily: 4,
            role: 'peer_candidate',
            source: 'stun',
        }],
    }));
    assert.equal(assessed.routeAssessment?.classification, 'direct_probable');
    assert.equal(assessed.routeAssessment?.independentDirectEvidenceCount, 1);
    assert.ok(assessed.routeAssessment?.limitations.includes('stun_peer_is_not_independent_confirmation'));
});

test('rejects DNS, public STUN, own endpoint, enrichment-only and weak samples as direct evidence', () => {
    const excluded = [
        candidate({ ip: '8.8.8.8', endpointRole: 'dns', networkCategory: 'dns', confidenceScore: 99 }),
        candidate({ ip: '192.0.2.20', endpointRole: 'stun_turn', networkCategory: 'stun_turn', confidenceScore: 99 }),
        candidate({ ip: '203.0.113.20', endpointRole: 'own_public_endpoint', confidenceScore: 99 }),
        candidate({ ip: '198.51.100.50', activeCallPackets: 3, packets: 3, confidenceScore: 99 }),
        candidate({
            ip: '198.51.100.60',
            isP2P: false,
            direction: 'outgoing',
            ipEnrichment: {
                ip: '198.51.100.60',
                provider: 'db-ip',
                sourceUrl: 'https://example.invalid',
                status: 'success',
                fetchedAt: '2026-09-08T12:00:00.000Z',
                cacheTtlSec: 60,
                accuracyNote: 'Synthetic enrichment only',
            },
        }),
    ];
    const assessed = correlateCallRoute(result({
        candidateIps: excluded,
        stunEndpoints: [{
            ip: '192.0.2.20',
            port: 3478,
            addressFamily: 4,
            role: 'stun_turn',
            source: 'stun',
        }],
    }));
    assert.equal(assessed.routeAssessment?.classification, 'unresolved');
    assert.equal(assessed.routeAssessment?.primaryCandidateIp, null);
    assert.equal(assessed.verdict, 'insufficient_data');
    assert.ok(assessed.routeAssessment?.reasonCodes.includes('DNS_EXCLUDED_FROM_DIRECT_EVIDENCE'));
    assert.ok(assessed.routeAssessment?.evidenceSources.includes('ip_enrichment'));
});

test('caps confidence when capture or the infrastructure registry is degraded', () => {
    const degraded = candidate({
        networkIntelligence: {
            asn: null,
            org: 'Unknown public network',
            category: 'consumer_isp_or_unknown',
            source: 'local_rules',
            isDatacenterLikely: false,
            caution: 'Degraded',
            registryEvidence: {
                schemaVersion: 1,
                registryVersion: 'test',
                registryPublishedAt: '2026-09-08T00:00:00.000Z',
                status: 'unknown',
                endpointRole: 'unknown',
                entryId: null,
                matchedCidr: null,
                category: null,
                provider: 'unknown',
                asn: null,
                org: 'Unknown public network',
                source: null,
                competingEntryIds: [],
                caution: 'Degraded',
                degraded: true,
            },
        },
    });
    const assessed = correlateCallRoute(result({
        candidateIps: [degraded],
        transportEvidence: transport(degraded.ip),
        captureBounds: { packetLimit: 100, storedPackets: 100, droppedPackets: 20, truncated: true },
        totalPackets: 120,
    }));
    assert.equal(assessed.routeAssessment?.classification, 'direct_confirmed');
    assert.equal(assessed.routeAssessment?.confidenceScore, 69);
    assert.ok(assessed.routeAssessment?.limitations.includes('packet_capture_truncated'));
    assert.ok(assessed.routeAssessment?.limitations.includes('infrastructure_registry_degraded'));
});
