import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type {
    CallAnalysisResult,
    CallRouteAssessment,
    CandidateIP,
} from '../src/call-analyzer.js';
import { normalizeStoredCallPhaseData } from '../src/call-analysis-history.js';
import { CallCapturePhaseLifecycle } from '../src/call-capture-phases.js';
import { normalizeStoredRouteAssessment } from '../src/call-route-assessment.js';
import { correlateCallRoute } from '../src/call-route-correlator.js';
import {
    scoreCandidate,
    type NetworkIntelligence,
} from '../src/call-scoring.js';
import {
    buildFinalCaseReport,
    renderFinalCaseReportHtml,
    renderFinalCaseReportPdf,
} from '../src/evidence-package.js';

type RouteClassification = CallRouteAssessment['classification'];
type EndpointKind = 'meta_relay' | 'consumer' | 'consumer_with_relay' | 'background'
    | 'mobile' | 'cloud' | 'ipv6_pending' | 'ipv6_eligible';

interface MatrixScenario {
    id: string;
    targetJid: string;
    endpointKind: EndpointKind;
    ip: string;
    addressFamily: 4 | 6;
    observedCountryCode: string;
    transportPeer?: boolean;
    expectedClassification: RouteClassification;
    expectedContext: 'match' | 'mismatch' | 'unavailable';
    scoreEquivalenceGroup?: string;
}

interface RegressionMatrix {
    schemaVersion: 1;
    provenance: string;
    scenarios: MatrixScenario[];
}

const matrix = JSON.parse(readFileSync(
    new URL('./fixtures/call-route-regression-matrix-v3.json', import.meta.url),
    'utf8',
)) as RegressionMatrix;

const START = new Date('2026-09-10T12:00:00.000Z');
const END = new Date('2026-09-10T12:00:30.000Z');

function registryEvidence(status: 'fresh' | 'unknown') {
    return {
        schemaVersion: 1 as const,
        registryVersion: 'synthetic-regression-v3',
        registryPublishedAt: '2026-09-10T00:00:00.000Z',
        status,
        entryId: null,
        matchedCidr: null,
        provider: 'unknown' as const,
        category: null,
        endpointRole: 'unknown' as const,
        asn: null,
        org: 'Synthetic public network',
        source: null,
        competingEntryIds: [],
        degraded: status !== 'fresh',
        caution: 'Synthetic regression evidence.',
    };
}

function intelligence(kind: EndpointKind): NetworkIntelligence {
    if (kind === 'meta_relay') {
        return {
            asn: 64510,
            org: 'Synthetic Meta relay',
            category: 'meta',
            source: 'local_rules',
            isDatacenterLikely: true,
            caution: 'Synthetic relay fixture.',
        };
    }
    if (kind === 'cloud') {
        return {
            asn: 64511,
            org: 'Synthetic ambiguous cloud',
            category: 'cloud_hosting',
            source: 'enrichment',
            isDatacenterLikely: true,
            caution: 'Synthetic cloud fixture.',
        };
    }
    if (kind === 'ipv6_pending') {
        return {
            asn: null,
            org: 'Synthetic IPv6 network pending classification',
            category: 'consumer_isp_or_unknown',
            source: 'local_rules',
            isDatacenterLikely: false,
            caution: 'Synthetic pending IPv6 fixture.',
            registryEvidence: registryEvidence('unknown'),
        };
    }
    if (kind === 'ipv6_eligible') {
        return {
            asn: 64512,
            org: 'Synthetic classified IPv6 access network',
            category: 'consumer_isp_or_unknown',
            source: 'local_rules',
            isDatacenterLikely: false,
            caution: 'Synthetic classified IPv6 fixture.',
            registryEvidence: registryEvidence('fresh'),
        };
    }
    return {
        asn: kind === 'mobile' ? 64513 : 64514,
        org: kind === 'mobile' ? 'Synthetic mobile access network' : 'Synthetic residential access network',
        category: 'consumer_isp_or_unknown',
        source: 'enrichment',
        isDatacenterLikely: false,
        caution: 'Synthetic access-network fixture.',
    };
}

function candidate(scenario: MatrixScenario): CandidateIP {
    const isBackground = scenario.endpointKind === 'background';
    const provider = scenario.endpointKind === 'meta_relay' ? 'meta' as const : 'unknown' as const;
    const packets = isBackground ? 10 : 180;
    const baselinePackets = isBackground ? 120 : 4;
    const direction = isBackground ? 'outgoing' as const : 'bidirectional' as const;
    const endpointIntelligence = intelligence(scenario.endpointKind);
    const score = scoreCandidate({
        provider,
        networkIntelligence: endpointIntelligence,
        packets,
        bytesTotal: packets * 240,
        direction,
        ports: [40_000],
        durationSec: 25,
        targetJid: scenario.targetJid,
        observedCountryCode: scenario.observedCountryCode,
        addressFamily: scenario.addressFamily,
        baselinePackets,
        baselineDurationSec: 5,
        onsetDelayMs: isBackground ? 45_000 : 1_000,
        protocolEvidence: ['transport_flow'],
    });
    return {
        ip: scenario.ip,
        packets: packets + baselinePackets,
        bytesTotal: (packets + baselinePackets) * 240,
        firstSeen: new Date(START.getTime() + 1_000),
        lastSeen: new Date(END.getTime() - 1_000),
        avgSize: 240,
        ports: [40_000],
        direction,
        provider,
        networkCategory: score.networkCategory,
        networkIntelligence: endpointIntelligence,
        geo: null,
        confidence: score.confidence,
        confidenceScore: score.confidenceScore,
        reasonCodes: score.reasonCodes,
        technicalNote: score.technicalNote,
        isP2P: score.isP2P,
        correlation: score.correlation,
        addressFamily: scenario.addressFamily,
        endpointRole: scenario.endpointKind === 'meta_relay'
            ? 'relay'
            : isBackground ? 'background' : 'direct_candidate',
        baselinePackets,
        activeCallPackets: packets,
        protocolEvidence: ['transport_flow'],
        scoreVersion: 3,
        networkContext: score.networkContext,
        scoreBreakdown: score.scoreBreakdown,
    };
}

function relayCandidate(targetJid: string): CandidateIP {
    return candidate({
        id: 'synthetic-relay-companion',
        targetJid,
        endpointKind: 'meta_relay',
        ip: '192.0.2.200',
        addressFamily: 4,
        observedCountryCode: 'CO',
        expectedClassification: 'relay_confirmed',
        expectedContext: 'match',
    });
}

function analysisFor(scenario: MatrixScenario): CallAnalysisResult {
    const primary = candidate(scenario);
    const withRelay = scenario.endpointKind === 'consumer_with_relay';
    const candidates = withRelay ? [primary, relayCandidate(scenario.targetJid)] : [primary];
    return {
        callId: `CALL-${scenario.id}`,
        targetJid: scenario.targetJid,
        startTime: START,
        endTime: END,
        durationSec: 30,
        isVideo: false,
        totalPackets: candidates.reduce((sum, item) => sum + item.packets, 0),
        candidateIps: candidates,
        metaIps: candidates.filter(item => item.provider === 'meta').map(item => item.ip),
        verdict: 'insufficient_data',
        captureInterface: '192.0.2.254',
        schemaVersion: 2,
        capturePhases: {
            baselineAvailable: true,
            baselineStartedAt: START,
            baselineEndedAt: new Date(START.getTime() + 5_000),
            negotiationStartedAt: new Date(START.getTime() + 6_000),
            activeCallStartedAt: new Date(START.getTime() + 7_000),
            callEndedAt: new Date(END.getTime() - 1_000),
            captureEndedAt: END,
        },
        ...(scenario.transportPeer ? {
            transportEvidence: {
                firstObservedAt: new Date(START.getTime() + 6_000),
                lastObservedAt: new Date(START.getTime() + 8_000),
                peerNegotiationObserved: true,
                relayNegotiationObserved: false,
                keepaliveObserved: false,
                candidateRounds: [1],
                endpoints: [{
                    ip: scenario.ip,
                    port: 40_000,
                    addressFamily: scenario.addressFamily,
                    role: 'peer_candidate' as const,
                    source: 'baileys_transport' as const,
                }],
                limitations: [],
            },
        } : {}),
        captureBounds: {
            packetLimit: 50_000,
            storedPackets: candidates.reduce((sum, item) => sum + item.packets, 0),
            droppedPackets: 0,
            truncated: false,
        },
    };
}

function minimalEvidencePackage(analyses: CallAnalysisResult[]): any {
    return {
        manifest: {
            packageType: 'evidence-package',
            version: '1.3',
            software: { name: 'WP MONITOR', version: '3.1.0', developedBy: 'WP MONITOR' },
            caseId: 'CASE-SYNTHETIC-MATRIX',
            generatedAt: '2026-09-10T12:01:00.000Z',
            contents: [],
            limitations: ['Synthetic regression evidence only.'],
        },
        sections: {
            case: {
                caseId: 'CASE-SYNTHETIC-MATRIX',
                title: 'Synthetic route matrix',
                status: 'authorized',
                primaryOperator: 'QA-SYNTHETIC',
                authorizationNote: 'Synthetic automated regression',
                description: 'No production or private data.',
                tags: ['synthetic'],
            },
            audit: [],
            evidenceLinks: [],
            callAnalysis: analyses,
            activityStats: [],
            observedActivity: [],
            networkSummary: { captureStartCount: 0, captureStopCount: 0, latestStats: null, captures: [] },
        },
        integrity: {
            algorithm: 'SHA-256',
            sectionHashes: {},
            packageHash: 'synthetic-source-package-hash',
            canonicalPayload: 'synthetic',
        },
    };
}

test('v3 regression matrix classifies route, network context, IPv4/IPv6, background, access and cloud cases', () => {
    assert.equal(matrix.schemaVersion, 1);
    assert.equal(matrix.scenarios.length, 10);

    const scoresByGroup = new Map<string, number>();
    for (const scenario of matrix.scenarios) {
        const assessed = correlateCallRoute(analysisFor(scenario));
        const primary = assessed.candidateIps[0];

        assert.equal(assessed.routeAssessment?.assessmentVersion, 3, scenario.id);
        assert.equal(assessed.routeAssessment?.classification, scenario.expectedClassification, scenario.id);
        assert.equal(primary?.networkContext?.relationship, scenario.expectedContext, scenario.id);
        assert.equal(primary?.networkContext?.affectsRouteScore, false, scenario.id);
        assert.equal(primary?.scoreBreakdown?.finalScore, primary?.confidenceScore, scenario.id);
        assert.equal(primary?.scoreBreakdown?.inputs.packets, primary?.activeCallPackets, scenario.id);

        if (scenario.endpointKind === 'background') {
            assert.equal(primary?.isP2P, false);
            assert.ok(primary?.reasonCodes.some(reason => reason.code === 'NO_BASELINE_INCREASE'));
        }
        if (scenario.endpointKind === 'cloud') {
            assert.equal(primary?.networkIntelligence.isDatacenterLikely, true);
            assert.equal(primary?.isP2P, false);
        }
        if (scenario.endpointKind === 'mobile') {
            assert.equal(primary?.networkIntelligence.category, 'consumer_isp_or_unknown');
            assert.equal(primary?.networkIntelligence.isDatacenterLikely, false);
        }
        if (scenario.endpointKind === 'ipv6_pending') {
            assert.ok(primary?.reasonCodes.some(reason => reason.code === 'IPV6_REGISTRY_PENDING'));
        }

        if (scenario.scoreEquivalenceGroup) {
            const prior = scoresByGroup.get(scenario.scoreEquivalenceGroup);
            if (prior === undefined) scoresByGroup.set(scenario.scoreEquivalenceGroup, primary!.confidenceScore);
            else assert.equal(primary?.confidenceScore, prior, `${scenario.id}: geographic context changed route score`);
        }
    }
});

test('historical v2 input, duplicate fields and malformed v3 extensions fail conservatively', () => {
    const validV2 = normalizeStoredRouteAssessment({
        assessmentVersion: 2,
        classification: 'direct_probable',
        confidenceScore: 60,
        evidenceSources: ['packet_flow', 'packet_flow'],
        independentDirectEvidenceCount: 1,
        primaryCandidateIp: '198.51.100.120',
        reasonCodes: ['STRONG_DIRECT_PACKET_PATTERN', 'STRONG_DIRECT_PACKET_PATTERN'],
        limitations: ['legacy_v2', 'legacy_v2'],
    });
    assert.deepEqual(validV2?.evidenceSources, ['packet_flow']);
    assert.deepEqual(validV2?.reasonCodes, ['STRONG_DIRECT_PACKET_PATTERN']);
    assert.deepEqual(validV2?.limitations, ['legacy_v2']);

    const historical = analysisFor(matrix.scenarios[1]!);
    const candidateV2 = { ...historical.candidateIps[0]!, scoreVersion: 2 as const };
    const malformedV3 = {
        ...historical.candidateIps[0]!,
        scoreVersion: 3 as const,
        scoreBreakdown: { ...historical.candidateIps[0]!.scoreBreakdown!, finalScore: 99 },
    };
    const normalized = normalizeStoredCallPhaseData({
        ...historical,
        candidateIps: [candidateV2, malformedV3],
    });
    assert.equal(normalized.candidateIps[0]?.scoreVersion, 2);
    assert.equal(normalized.candidateIps[0]?.scoreBreakdown, undefined);
    assert.equal(normalized.candidateIps[1]?.scoreVersion, undefined);
    assert.equal(normalized.candidateIps[1]?.scoreBreakdown, undefined);
});

test('duplicate and out-of-order phase events remain idempotent and monotonic', () => {
    let now = new Date('2026-09-10T12:00:00.000Z');
    const lifecycle = new CallCapturePhaseLifecycle(() => now);
    const targetJid = '573000000099@s.whatsapp.net';
    assert.equal(lifecycle.start({ captureCallId: 'CAPTURE-SYNTHETIC', targetJid, trigger: 'manual' }), true);

    now = new Date('2026-09-10T12:00:02.000Z');
    assert.equal(lifecycle.observe(targetJid, 'CALL-SYNTHETIC', 'offer'), true);
    assert.equal(lifecycle.observe(targetJid, 'CALL-SYNTHETIC', 'offer'), true);
    now = new Date('2026-09-10T12:00:04.000Z');
    assert.equal(lifecycle.observe(targetJid, 'CALL-SYNTHETIC', 'accept'), true);
    now = new Date('2026-09-10T12:00:05.000Z');
    assert.equal(lifecycle.observe(targetJid, 'CALL-SYNTHETIC', 'ringing'), false);
    assert.equal(lifecycle.observe(targetJid, 'CALL-FOREIGN', 'terminate'), false);

    const evidence = lifecycle.snapshot()?.phaseEvidence ?? [];
    assert.deepEqual(evidence.map(event => event.kind), [
        'baseline_started',
        'negotiation_started',
        'active_started',
    ]);
    assert.equal(evidence[1]?.corroborations?.length ?? 0, 0);
    assert.deepEqual(evidence.map(event => event.sequence), [1, 2, 3]);
});

test('all route outcomes preserve semantic parity in JSON, HTML and PDF reports', () => {
    const analyses = matrix.scenarios.map(scenario => correlateCallRoute(analysisFor(scenario)));
    const report = buildFinalCaseReport(minimalEvidencePackage(analyses));
    const html = renderFinalCaseReportHtml(report);
    const pdf = renderFinalCaseReportPdf(report).toString('ascii');
    const expectedPdfLabels: Record<RouteClassification, string> = {
        direct_confirmed: 'Ruta directa confirmada',
        direct_probable: 'Ruta directa probable',
        relay_confirmed: 'Conexion mediante infraestructura de WhatsApp',
        mixed: 'Ruta mixta observada',
        unresolved: 'Ruta no determinada',
    };

    assert.equal(report.version, '1.3');
    assert.equal(report.findings.callRoutes.length, matrix.scenarios.length);
    for (const route of report.findings.callRoutes) {
        assert.match(html, new RegExp(route.presentation.classificationLabel));
        assert.match(pdf, new RegExp(expectedPdfLabels[route.classification as RouteClassification]));
    }
    assert.ok(report.findings.observedEndpoints.every((endpoint: any) => (
        endpoint.networkContextPresentation.affectsRouteScore === false
        && endpoint.networkContextPresentation.uncertainty.radiusKm === null
    )));
});

test('matrix fixtures and generated reports contain only synthetic identifiers and no private payload fields', () => {
    const fixtureText = JSON.stringify(matrix);
    const reportText = JSON.stringify(buildFinalCaseReport(minimalEvidencePackage(
        matrix.scenarios.map(scenario => correlateCallRoute(analysisFor(scenario))),
    )));
    const combined = `${fixtureText}\n${reportText}`;

    assert.match(matrix.provenance, /Synthetic RFC 5737\/RFC 3849/);
    assert.doesNotMatch(combined, /(?:password|secret|token|cookie|authorizationBearer|messageContent|sessionData)/i);
    assert.doesNotMatch(combined, /@[cg]\.us|@lid/);
    assert.ok(matrix.scenarios.every(scenario => (
        scenario.ip.startsWith('192.0.2.')
        || scenario.ip.startsWith('198.51.100.')
        || scenario.ip.startsWith('203.0.113.')
        || scenario.ip.startsWith('2001:db8:')
    )));
});
