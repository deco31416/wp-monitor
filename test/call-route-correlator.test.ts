import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateCallRoute } from '../src/call-route-correlator.js';
import type { CallAnalysisResult, CandidateIP } from '../src/call-analyzer.js';
import type { BrowserWebRtcEvidence } from '../src/call-observation-evidence.js';

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

function phaseCounts(activePackets = 30) {
    return {
        version: 1 as const,
        baseline: { packets: 0, bytes: 0 },
        negotiation: { packets: 0, bytes: 0 },
        active: { packets: activePackets, bytes: activePackets * 200 },
        postCall: { packets: 0, bytes: 0 },
        unclassified: { packets: 0, bytes: 0 },
    };
}

function browserPair(options: {
    remoteAddress?: string | null;
    remotePort?: number | null;
    remoteType?: 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';
} = {}): BrowserWebRtcEvidence {
    return {
        version: 1 as const,
        status: 'available' as const,
        startedAt: new Date('2026-09-08T12:00:00.000Z'),
        endedAt: new Date('2026-09-08T12:00:30.000Z'),
        connectionCount: 1,
        selectedPairs: [{
            peerConnectionId: 'pc-1',
            state: 'succeeded' as const,
            nominated: true,
            selected: true,
            firstObservedAt: new Date('2026-09-08T12:00:08.000Z'),
            lastObservedAt: new Date('2026-09-08T12:00:28.000Z'),
            local: {
                candidateType: 'host' as const,
                protocol: 'udp' as const,
                relayProtocol: 'unknown' as const,
                address: '192.0.2.10',
                addressFamily: 4 as const,
                port: 50_000,
            },
            remote: {
                candidateType: options.remoteType ?? 'srflx' as const,
                protocol: 'udp' as const,
                relayProtocol: options.remoteType === 'relay' ? 'udp' as const : 'unknown' as const,
                address: options.remoteAddress === undefined ? '198.51.100.40' : options.remoteAddress,
                addressFamily: options.remoteAddress === null ? null : 4 as const,
                port: options.remotePort === undefined ? 40_000 : options.remotePort,
            },
            packetsSent: 15,
            packetsReceived: 15,
            bytesSent: 3_000,
            bytesReceived: 3_000,
            currentRoundTripTimeMs: 30,
        }],
        stateTransitions: [],
        truncated: false,
        limitations: [],
    };
}

function flowEvidence(overrides: { remoteIp?: string; remotePort?: number; direction?: 'incoming' | 'outgoing' | 'bidirectional'; packets?: number } = {}) {
    const packets = overrides.packets ?? 30;
    return {
        version: 1 as const,
        flowLimit: 1_024,
        storedFlows: 1,
        droppedPackets: 0,
        truncated: false,
        flows: [{
            addressFamily: 4 as const,
            protocol: 'udp' as const,
            localPort: 50_000,
            remoteIp: overrides.remoteIp ?? '198.51.100.40',
            remotePort: overrides.remotePort ?? 40_000,
            firstSeen: new Date('2026-09-08T12:00:08.000Z'),
            lastSeen: new Date('2026-09-08T12:00:28.000Z'),
            direction: overrides.direction ?? 'bidirectional' as const,
            packets,
            bytesTotal: packets * 200,
            phaseCounts: phaseCounts(packets),
            protocolEvidence: ['transport_flow'],
        }],
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

test('publishes route assessment v3 only when fed by candidate scoring v3', () => {
    const v3 = candidate({
        scoreVersion: 3,
        networkContext: {
            version: 1,
            targetCallingCode: '57',
            targetCountryCode: 'CO',
            observedCountryCode: 'CO',
            relationship: 'match',
            affectsRouteScore: false,
            reasonCodes: ['PHONE_GEO_CONTEXT_MATCH'],
            limitations: ['phone_prefix_is_context_not_location'],
        },
        scoreBreakdown: {
            version: 3,
            rawScore: 62,
            finalScore: 62,
            inputs: {
                packets: 100,
                bytesTotal: 20_000,
                durationSec: 20,
                direction: 'bidirectional',
                ports: [40_000],
                baselinePackets: 20,
                baselineDurationSec: 5,
                onsetDelayMs: 1_000,
                protocolEvidence: ['transport_flow'],
            },
            components: [{ code: 'SYNTHETIC_ROUTE_SCORE', label: 'Synthetic route score', delta: 62 }],
            caps: [],
        },
    });
    const assessed = correlateCallRoute(result({ candidateIps: [v3] }));

    assert.equal(assessed.routeAssessment?.assessmentVersion, 3);
    assert.ok(assessed.routeAssessment?.reasonCodes.includes('CANDIDATE_SCORING_V3'));
    assert.ok(assessed.routeAssessment?.reasonCodes.includes('GEOGRAPHIC_CONTEXT_NOT_ROUTE_EVIDENCE'));
});

test('publishes v4 direct confirmation only for an eligible exact browser and active five-tuple match', () => {
    const assessed = correlateCallRoute(result({
        candidateIps: [candidate()],
        browserWebRtcEvidence: browserPair(),
        flowEvidence: flowEvidence(),
    }));

    assert.equal(assessed.routeAssessment?.assessmentVersion, 4);
    assert.equal(assessed.routeAssessment?.classification, 'direct_confirmed');
    assert.equal(assessed.routeAssessment?.independentDirectEvidenceCount, 2);
    assert.equal(assessed.routeAssessment?.primaryCandidateIp, '198.51.100.40');
    assert.ok(assessed.routeAssessment?.reasonCodes.includes('BROWSER_SELECTED_CANDIDATE_MATCHES_ACTIVE_FIVE_TUPLE'));
    assert.ok(assessed.routeAssessment?.evidenceSources.includes('browser_webrtc'));
    assert.ok(assessed.routeAssessment?.evidenceSources.includes('five_tuple_flow'));
});

test('does not elevate a browser candidate when the active five-tuple is weak or divergent', () => {
    for (const flow of [
        flowEvidence({ remotePort: 40_001 }),
        flowEvidence({ direction: 'outgoing' }),
        flowEvidence({ packets: 19 }),
    ]) {
        const assessed = correlateCallRoute(result({
            candidateIps: [candidate()],
            browserWebRtcEvidence: browserPair(),
            flowEvidence: flow,
        }));
        assert.equal(assessed.routeAssessment?.classification, 'direct_probable');
        assert.equal(assessed.routeAssessment?.independentDirectEvidenceCount, 1);
        assert.equal(assessed.routeAssessment?.reasonCodes.includes('BROWSER_SELECTED_CANDIDATE_MATCHES_ACTIVE_FIVE_TUPLE'), false);
    }
});

test('classifies a selected browser relay and exposes hidden-address limitations deterministically', () => {
    const relay = correlateCallRoute(result({ browserWebRtcEvidence: browserPair({
        remoteAddress: '57.144.85.57',
        remotePort: 34_78,
        remoteType: 'relay',
    }) }));
    assert.equal(relay.routeAssessment?.classification, 'relay_confirmed');
    assert.ok(relay.routeAssessment?.reasonCodes.includes('BROWSER_SELECTED_RELAY_OBSERVED'));

    const hiddenInput = result({ browserWebRtcEvidence: browserPair({ remoteAddress: null, remotePort: null }) });
    const first = correlateCallRoute(hiddenInput);
    const second = correlateCallRoute(hiddenInput);
    assert.deepEqual(second.routeAssessment, first.routeAssessment);
    assert.equal(first.routeAssessment?.classification, 'unresolved');
    assert.ok(first.routeAssessment?.limitations.includes('browser_candidate_address_not_exposed'));
});

test('propagates bounded protocol-source limitations into the v4 route conclusion', () => {
    const browser = browserPair();
    browser.limitations.push('browser_webrtc_armed_after_automatic_call_signal');
    browser.truncated = true;
    const assessed = correlateCallRoute(result({
        candidateIps: [candidate()],
        browserWebRtcEvidence: browser,
        flowEvidence: flowEvidence(),
        stunTurnEvidence: {
            version: 1,
            transactionLimit: 256,
            storedTransactions: 0,
            droppedTransactions: 0,
            truncated: false,
            transactions: [],
            channels: [],
            limitations: ['turn_channel_data_without_observed_channel_bind'],
        },
    }));

    assert.ok(assessed.routeAssessment?.limitations.includes('browser_webrtc_armed_after_automatic_call_signal'));
    assert.ok(assessed.routeAssessment?.limitations.includes('browser_webrtc_evidence_truncated'));
    assert.ok(assessed.routeAssessment?.limitations.includes('turn_channel_data_without_observed_channel_bind'));
});
