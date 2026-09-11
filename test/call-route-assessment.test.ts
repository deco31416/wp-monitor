import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoredRouteAssessment } from '../src/call-route-assessment.js';

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
