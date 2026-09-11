import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStoredCallPhaseData } from '../src/call-analysis-history.js';
import type { CallAnalysisResult, CandidateIP } from '../src/call-analyzer.js';
import type { CallCapturePhaseCounts } from '../src/call-capture-phases.js';

function phaseCounts(overrides: Partial<CallCapturePhaseCounts> = {}): CallCapturePhaseCounts {
    return {
        version: 1,
        baseline: { packets: 1, bytes: 100 },
        negotiation: { packets: 1, bytes: 120 },
        active: { packets: 1, bytes: 140 },
        postCall: { packets: 1, bytes: 160 },
        unclassified: { packets: 0, bytes: 0 },
        ...overrides,
    };
}

function candidate(overrides: Partial<CandidateIP> = {}): CandidateIP {
    return {
        ip: '198.51.100.20',
        packets: 4,
        bytesTotal: 520,
        firstSeen: new Date('2026-09-10T12:00:00.000Z'),
        lastSeen: new Date('2026-09-10T12:00:04.000Z'),
        avgSize: 130,
        ports: [40_000],
        direction: 'bidirectional',
        provider: 'unknown',
        networkCategory: 'consumer_isp_or_unknown',
        networkIntelligence: {
            asn: 64_512,
            org: 'Synthetic ISP',
            category: 'consumer_isp_or_unknown',
            source: 'local_rules',
            isDatacenterLikely: false,
            caution: 'Synthetic fixture.',
        },
        geo: null,
        confidence: 'low',
        confidenceScore: 10,
        reasonCodes: [],
        technicalNote: 'Synthetic fixture.',
        isP2P: false,
        ...overrides,
    };
}

function analysis(overrides: Partial<CallAnalysisResult> = {}): CallAnalysisResult {
    return {
        callId: 'CALL-HISTORY-001',
        targetJid: '573001112233@s.whatsapp.net',
        startTime: new Date('2026-09-10T12:00:00.000Z'),
        endTime: new Date('2026-09-10T12:00:05.000Z'),
        durationSec: 5,
        isVideo: false,
        totalPackets: 5,
        candidateIps: [candidate()],
        metaIps: [],
        verdict: 'insufficient_data',
        captureInterface: '192.0.2.10',
        ...overrides,
    };
}

test('keeps legacy analyses unavailable instead of inventing detailed phases', () => {
    const stored = analysis({
        candidateIps: [candidate({ baselinePackets: 1, activeCallPackets: 3 })],
    });

    const normalized = normalizeStoredCallPhaseData(stored);

    assert.equal(normalized.phaseCounts, undefined);
    assert.equal(normalized.candidateIps[0]?.phaseCounts, undefined);
    assert.equal(normalized.candidateIps[0]?.baselinePackets, 1);
    assert.equal(normalized.candidateIps[0]?.activeCallPackets, 3);
});

test('preserves a complete C5 phase book and clones its bounded counts', () => {
    const endpointCounts = phaseCounts();
    const globalCounts = phaseCounts({
        unclassified: { packets: 1, bytes: 80 },
    });
    const stored = analysis({
        captureBounds: { packetLimit: 50_000, storedPackets: 5, droppedPackets: 0, truncated: false },
        phaseCounts: globalCounts,
        candidateIps: [candidate({
            baselinePackets: 1,
            activeCallPackets: 3,
            phaseCounts: endpointCounts,
        })],
    });

    const normalized = normalizeStoredCallPhaseData(stored);

    assert.deepEqual(normalized.phaseCounts, globalCounts);
    assert.deepEqual(normalized.candidateIps[0]?.phaseCounts, endpointCounts);
    assert.notEqual(normalized.phaseCounts, globalCounts);
    assert.notEqual(normalized.candidateIps[0]?.phaseCounts, endpointCounts);
});

test('removes an incomplete detailed book atomically without mutating storage input', () => {
    const endpointCounts = phaseCounts();
    const stored = analysis({
        captureBounds: { packetLimit: 50_000, storedPackets: 5, droppedPackets: 0, truncated: false },
        phaseCounts: phaseCounts({ unclassified: { packets: 1, bytes: 80 } }),
        candidateIps: [
            candidate({ phaseCounts: endpointCounts }),
            candidate({ ip: '203.0.113.30' }),
        ],
    });

    const normalized = normalizeStoredCallPhaseData(stored);

    assert.equal(normalized.phaseCounts, undefined);
    assert.equal(normalized.candidateIps[0]?.phaseCounts, undefined);
    assert.equal(normalized.candidateIps[1]?.phaseCounts, undefined);
    assert.equal(stored.phaseCounts?.version, 1);
    assert.equal(stored.candidateIps[0]?.phaseCounts, endpointCounts);
});

test('drops malformed global, endpoint and legacy counts instead of repairing evidence', () => {
    const malformedGlobal = {
        ...phaseCounts({ unclassified: { packets: 1, bytes: 80 } }),
        active: { packets: Number.NaN, bytes: 140 },
    } as CallCapturePhaseCounts;
    const stored = analysis({
        captureBounds: { packetLimit: 50_000, storedPackets: 5, droppedPackets: 0, truncated: false },
        phaseCounts: malformedGlobal,
        candidateIps: [candidate({
            baselinePackets: 2,
            activeCallPackets: 3,
            phaseCounts: phaseCounts({ active: { packets: 2, bytes: 140 } }),
        })],
    });

    const normalized = normalizeStoredCallPhaseData(stored);

    assert.equal(normalized.phaseCounts, undefined);
    assert.equal(normalized.candidateIps[0]?.phaseCounts, undefined);
    assert.equal(normalized.candidateIps[0]?.baselinePackets, undefined);
    assert.equal(normalized.candidateIps[0]?.activeCallPackets, undefined);
});

test('rejects a globally inconsistent stored-packet total without rewriting capture bounds', () => {
    const stored = analysis({
        captureBounds: { packetLimit: 50_000, storedPackets: 4, droppedPackets: 1, truncated: true },
        phaseCounts: phaseCounts({ unclassified: { packets: 1, bytes: 80 } }),
        candidateIps: [candidate({ phaseCounts: phaseCounts() })],
    });

    const normalized = normalizeStoredCallPhaseData(stored);

    assert.equal(normalized.phaseCounts, undefined);
    assert.deepEqual(normalized.captureBounds, stored.captureBounds);
});

test('preserves a coherent stored v3 score and removes malformed v3 extensions atomically', () => {
    const v3 = candidate({
        baselinePackets: 1,
        activeCallPackets: 3,
        scoreVersion: 3,
        reasonCodes: [{ code: 'SYNTHETIC_SCORE', label: 'Synthetic score', delta: 20 }],
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
            rawScore: 20,
            finalScore: 10,
            inputs: {
                packets: 3,
                bytesTotal: 420,
                durationSec: 3,
                direction: 'bidirectional',
                ports: [40_000],
                baselinePackets: 1,
                baselineDurationSec: 1,
                onsetDelayMs: 100,
                protocolEvidence: ['transport_flow'],
            },
            components: [{ code: 'SYNTHETIC_SCORE', label: 'Synthetic score', delta: 20 }],
            caps: [{ code: 'HARD_CAP_TINY_SAMPLE', maximum: 10, before: 20, after: 10 }],
        },
    });
    const valid = normalizeStoredCallPhaseData(analysis({ candidateIps: [v3] }));
    assert.equal(valid.candidateIps[0]?.scoreVersion, 3);
    assert.equal(valid.candidateIps[0]?.networkContext?.affectsRouteScore, false);

    const malformed = normalizeStoredCallPhaseData(analysis({
        candidateIps: [candidate({
            ...v3,
            scoreBreakdown: { ...v3.scoreBreakdown!, rawScore: 21 },
        })],
    }));
    assert.equal(malformed.candidateIps[0]?.scoreVersion, undefined);
    assert.equal(malformed.candidateIps[0]?.networkContext, undefined);
    assert.equal(malformed.candidateIps[0]?.scoreBreakdown, undefined);
});
