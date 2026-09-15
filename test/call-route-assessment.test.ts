import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoredRouteAssessment } from '../src/call-route-assessment.js';
import { normalizeStoredCallObservationEvidence, normalizeStoredCallPhaseData } from '../src/call-analysis-history.js';
import { relayWithEmptyWebRtc } from './fixtures/relay-empty-webrtc.js';

test('E4 relay survives serialization and evidence normalization with no selected browser pair', () => {
    const original = relayWithEmptyWebRtc();
    assert.equal(original.routeAssessment?.classification, 'relay_confirmed');
    assert.equal(original.routeAssessment?.confidenceScore, 78);
    assert.equal(original.routeAssessment?.primaryCandidateIp, null);
    const stored = normalizeStoredCallObservationEvidence(normalizeStoredCallPhaseData(
        JSON.parse(JSON.stringify(original)),
    ));
    assert.ok(stored.browserWebRtcEvidence);
    assert.ok(stored.flowEvidence);
    assert.deepEqual(normalizeStoredRouteAssessment(stored.routeAssessment, stored), original.routeAssessment);
});

test('contextual browser and flow books do not require direct confirmation for probable, mixed-probable or unresolved routes', () => {
    const evidence = relayWithEmptyWebRtc();
    for (const classification of ['direct_probable', 'mixed', 'unresolved'] as const) {
        const assessment = {
            ...evidence.routeAssessment!, classification,
            confidenceScore: classification === 'unresolved' ? 20 : 60,
            independentDirectEvidenceCount: classification === 'unresolved' ? 0 : 1,
            primaryCandidateIp: classification === 'unresolved' ? null : '203.0.113.40',
            reasonCodes: [], limitations: [],
        };
        assert.deepEqual(normalizeStoredRouteAssessment(assessment, evidence), assessment);
    }
});

test('direct and mixed confirmations still reject empty browser pairs', () => {
    const evidence = relayWithEmptyWebRtc();
    for (const classification of ['direct_confirmed', 'mixed'] as const) {
        const assessment = {
            ...evidence.routeAssessment!, classification,
            independentDirectEvidenceCount: 2, primaryCandidateIp: '203.0.113.40',
        };
        assert.deepEqual(normalizeStoredRouteAssessment(assessment, evidence)?.limitations, ['stored_observation_invalid']);
    }
});

test('relay still rejects missing declared books and impossible direct evidence counts', () => {
    const evidence = relayWithEmptyWebRtc();
    assert.deepEqual(normalizeStoredRouteAssessment(evidence.routeAssessment, {})?.limitations, ['stored_observation_invalid']);
    assert.deepEqual(normalizeStoredRouteAssessment({
        ...evidence.routeAssessment!, independentDirectEvidenceCount: 2,
    }, evidence)?.limitations, ['stored_observation_invalid']);
});

test('preserves and deduplicates a valid stored route assessment', () => {
    assert.deepEqual(normalizeStoredRouteAssessment({
        assessmentVersion: 2,
        classification: 'direct_confirmed',
        confidenceScore: 88,
        evidenceSources: ['packet_flow', 'baileys_transport', 'packet_flow'],
        independentDirectEvidenceCount: 2,
        primaryCandidateIp: '203.0.113.10',
        reasonCodes: ['PACKET_FLOW_MATCHES_BAILEYS_PEER', 'PACKET_FLOW_MATCHES_BAILEYS_PEER'],
        limitations: [],
    }), {
        assessmentVersion: 2,
        classification: 'direct_confirmed',
        confidenceScore: 88,
        evidenceSources: ['packet_flow', 'baileys_transport'],
        independentDirectEvidenceCount: 2,
        primaryCandidateIp: '203.0.113.10',
        reasonCodes: ['PACKET_FLOW_MATCHES_BAILEYS_PEER'],
        limitations: [],
    });
});

test('preserves a valid v3 assessment without rewriting historical v2 records', () => {
    const normalized = normalizeStoredRouteAssessment({
        assessmentVersion: 3,
        classification: 'direct_probable',
        confidenceScore: 64,
        evidenceSources: ['packet_flow', 'baseline'],
        independentDirectEvidenceCount: 1,
        primaryCandidateIp: '203.0.113.20',
        reasonCodes: ['CANDIDATE_SCORING_V3'],
        limitations: [],
    });

    assert.equal(normalized?.assessmentVersion, 3);
    assert.equal(normalized?.classification, 'direct_probable');
});

test('preserves a semantically valid v4 browser and five-tuple confirmation', () => {
    const normalized = normalizeStoredRouteAssessment({
        assessmentVersion: 4,
        classification: 'direct_confirmed',
        confidenceScore: 82,
        evidenceSources: ['packet_flow', 'browser_webrtc', 'five_tuple_flow'],
        independentDirectEvidenceCount: 2,
        primaryCandidateIp: '198.51.100.40',
        reasonCodes: ['BROWSER_SELECTED_CANDIDATE_MATCHES_ACTIVE_FIVE_TUPLE'],
        limitations: [],
    });

    assert.equal(normalized?.assessmentVersion, 4);
    assert.equal(normalized?.classification, 'direct_confirmed');
    assert.deepEqual(normalized?.evidenceSources, ['packet_flow', 'browser_webrtc', 'five_tuple_flow']);
});

test('fails a v4 confirmation closed when its declared evidence books are missing', () => {
    const normalized = normalizeStoredRouteAssessment({
        assessmentVersion: 4,
        classification: 'direct_confirmed',
        confidenceScore: 82,
        evidenceSources: ['packet_flow', 'browser_webrtc', 'five_tuple_flow'],
        independentDirectEvidenceCount: 2,
        primaryCandidateIp: '198.51.100.40',
        reasonCodes: ['BROWSER_SELECTED_CANDIDATE_MATCHES_ACTIVE_FIVE_TUPLE'],
        limitations: [],
    }, {});

    assert.equal(normalized?.classification, 'unresolved');
    assert.deepEqual(normalized?.limitations, ['stored_observation_invalid']);
});

test('fails a persisted v4 confirmation closed when the selected candidate type is unknown', () => {
    const assessment = {
        assessmentVersion: 4,
        classification: 'direct_confirmed',
        confidenceScore: 82,
        evidenceSources: ['packet_flow', 'browser_webrtc', 'five_tuple_flow'],
        independentDirectEvidenceCount: 2,
        primaryCandidateIp: '198.51.100.40',
        reasonCodes: ['BROWSER_SELECTED_CANDIDATE_MATCHES_ACTIVE_FIVE_TUPLE'],
        limitations: [],
    };
    const startedAt = new Date('2026-09-11T12:00:00.000Z');
    const endedAt = new Date('2026-09-11T12:01:00.000Z');
    const normalized = normalizeStoredRouteAssessment(assessment, {
        browserWebRtcEvidence: {
            version: 1,
            status: 'available',
            startedAt,
            endedAt,
            connectionCount: 1,
            selectedPairs: [{
                peerConnectionId: 'pc-1',
                state: 'succeeded',
                nominated: true,
                selected: true,
                firstObservedAt: startedAt,
                lastObservedAt: endedAt,
                local: {
                    candidateType: 'host', protocol: 'udp', relayProtocol: 'unknown',
                    address: '192.0.2.10', addressFamily: 4, port: 50_000,
                },
                remote: {
                    candidateType: 'unknown', protocol: 'udp', relayProtocol: 'unknown',
                    address: '198.51.100.40', addressFamily: 4, port: 40_000,
                },
                packetsSent: 20,
                packetsReceived: 20,
                bytesSent: 4_000,
                bytesReceived: 4_000,
                currentRoundTripTimeMs: 30,
            }],
            stateTransitions: [],
            truncated: false,
            limitations: [],
        },
        flowEvidence: {
            version: 1,
            flowLimit: 1_024,
            storedFlows: 1,
            droppedPackets: 0,
            truncated: false,
            flows: [{
                addressFamily: 4,
                protocol: 'udp',
                localPort: 50_000,
                remoteIp: '198.51.100.40',
                remotePort: 40_000,
                firstSeen: startedAt,
                lastSeen: endedAt,
                direction: 'bidirectional',
                packets: 40,
                bytesTotal: 8_000,
                phaseCounts: {
                    version: 1,
                    baseline: { packets: 0, bytes: 0 },
                    negotiation: { packets: 10, bytes: 2_000 },
                    active: { packets: 30, bytes: 6_000 },
                    postCall: { packets: 0, bytes: 0 },
                    unclassified: { packets: 0, bytes: 0 },
                },
                protocolEvidence: ['transport_flow'],
            }],
        },
    });

    assert.equal(normalized?.classification, 'unresolved');
    assert.deepEqual(normalized?.limitations, ['stored_observation_invalid']);
});

test('keeps an absent assessment distinguishable from invalid stored data', () => {
    assert.equal(normalizeStoredRouteAssessment(undefined), undefined);
    assert.deepEqual(normalizeStoredRouteAssessment({
        assessmentVersion: 2,
        classification: 'direct_confirmed',
        confidenceScore: 101,
        evidenceSources: 'packet_flow',
    }), {
        assessmentVersion: 2,
        classification: 'unresolved',
        confidenceScore: 0,
        evidenceSources: [],
        independentDirectEvidenceCount: 0,
        primaryCandidateIp: null,
        reasonCodes: [],
        limitations: ['stored_observation_invalid'],
    });
});

test('rejects oversized persisted route fields before report rendering', () => {
    assert.deepEqual(normalizeStoredRouteAssessment({
        assessmentVersion: 2,
        classification: 'direct_probable',
        confidenceScore: 50,
        evidenceSources: ['packet_flow'],
        independentDirectEvidenceCount: 1,
        primaryCandidateIp: '203.0.113.10',
        reasonCodes: Array.from({ length: 17 }, (_, index) => `REASON_${index}`),
        limitations: [],
    })?.limitations, ['stored_observation_invalid']);
});

test('rejects structurally valid but semantically impossible route conclusions', () => {
    const impossible = [
        {
            assessmentVersion: 2,
            classification: 'direct_confirmed',
            confidenceScore: 88,
            evidenceSources: ['packet_flow'],
            independentDirectEvidenceCount: 2,
            primaryCandidateIp: '203.0.113.10',
            reasonCodes: [],
            limitations: [],
        },
        {
            assessmentVersion: 2,
            classification: 'relay_confirmed',
            confidenceScore: 80,
            evidenceSources: ['packet_flow'],
            independentDirectEvidenceCount: 1,
            primaryCandidateIp: '203.0.113.10',
            reasonCodes: [],
            limitations: [],
        },
        {
            assessmentVersion: 2,
            classification: 'unresolved',
            confidenceScore: 90,
            evidenceSources: ['packet_flow'],
            independentDirectEvidenceCount: 0,
            primaryCandidateIp: null,
            reasonCodes: [],
            limitations: [],
        },
    ];

    for (const assessment of impossible) {
        assert.deepEqual(
            normalizeStoredRouteAssessment(assessment)?.limitations,
            ['stored_observation_invalid'],
        );
    }
});
