import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateEvidenceRecordLimits, buildEvidencePackage, buildEvidenceZip, buildFinalCaseReport, renderFinalCaseReportHtml, renderFinalCaseReportPdf } from '../src/evidence-package.js';

function readStoredZipEntry(zip: Buffer, expectedName: string): string {
    let offset = 0;
    while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
        const compressionMethod = zip.readUInt16LE(offset + 8);
        const compressedSize = zip.readUInt32LE(offset + 18);
        const nameLength = zip.readUInt16LE(offset + 26);
        const extraLength = zip.readUInt16LE(offset + 28);
        const nameStart = offset + 30;
        const dataStart = nameStart + nameLength + extraLength;
        const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf8');
        if (name === expectedName) {
            assert.equal(compressionMethod, 0, `Expected ${expectedName} to use the repository's stored ZIP format`);
            return zip.subarray(dataStart, dataStart + compressedSize).toString('utf8');
        }
        offset = dataStart + compressedSize;
    }
    assert.fail(`ZIP entry not found: ${expectedName}`);
}

function sampleEvidencePackage(): any {
    return {
        manifest: {
            packageType: 'evidence-package',
            version: '1.3',
            software: {
                name: 'WP MONITOR',
                version: '2.6.0',
                developedBy: 'WP MONITOR',
            },
            caseId: 'CASE-UNIT-001',
            generatedAt: '2026-06-18T00:00:00.000Z',
            interpretation: {
                candidateScoreCurrentVersion: 3,
                geographicContextAffectsRouteScore: false,
                geoIpUncertainty: { radiusKm: null, status: 'not_quantified_by_provider' },
                humanEndpointPresentationLimitPerGroup: 10,
            },
            contents: [],
            limitations: [
                'Candidate IPs do not prove identity, exact location, or ownership by a person.',
            ],
        },
        sections: {
            case: {
                caseId: 'CASE-UNIT-001',
                title: 'Unit test case',
                status: 'authorized',
                primaryOperator: 'QA',
                authorizationNote: 'Authorized unit test',
                description: 'Synthetic evidence package',
                tags: ['qa'],
            },
            audit: [
                {
                    caseId: 'CASE-UNIT-001',
                    operatorName: 'QA',
                    authorizationNote: 'Authorized unit test',
                    action: 'call_capture_stop',
                    scope: 'call',
                    targetJid: 'synthetic-contact@s.whatsapp.net',
                    details: { callId: 'CALL-1' },
                    timestamp: new Date('2026-06-18T00:00:01.000Z'),
                    timestampUtc: '2026-06-18T00:00:01.000Z',
                },
            ],
            evidenceLinks: [
                {
                    caseId: 'CASE-UNIT-001',
                    type: 'call_analysis',
                    refId: 'CALL-1',
                    label: 'Call analysis',
                    targetJid: 'synthetic-contact@s.whatsapp.net',
                    metadata: { source: 'unit' },
                    createdAt: new Date('2026-06-18T00:00:02.000Z'),
                    updatedAt: new Date('2026-06-18T00:00:02.000Z'),
                },
            ],
            callAnalysis: [
                {
                    callId: 'CALL-1',
                    targetJid: 'synthetic-contact@s.whatsapp.net',
                    startTime: new Date('2026-06-18T00:00:00.000Z'),
                    endTime: new Date('2026-06-18T00:00:10.000Z'),
                    durationSec: 10,
                    isVideo: false,
                    totalPackets: 120,
                    candidateIps: [
                        {
                            ip: '203.0.113.50',
                            packets: 100,
                            bytesTotal: 12000,
                            firstSeen: new Date('2026-06-18T00:00:01.000Z'),
                            lastSeen: new Date('2026-06-18T00:00:09.000Z'),
                            avgSize: 120,
                            ports: [443],
                            direction: 'bidirectional',
                            provider: 'unknown',
                            networkCategory: 'consumer_isp_or_unknown',
                            networkIntelligence: {
                                asn: 15169,
                                org: 'Google',
                                category: 'stun_turn',
                                source: 'local_rules',
                                isDatacenterLikely: true,
                                caution: 'Unit test caution',
                            },
                            geo: { country: 'US', region: 'Synthetic region', city: 'Synthetic city', lat: 0, lon: 0, timezone: 'UTC' },
                            confidence: 'medium',
                            confidenceScore: 55,
                            reasonCodes: [{ code: 'UNIT', label: 'Unit reason', delta: 1 }],
                            technicalNote: 'IP publica observada como candidata tecnica. No confirma identidad, ubicacion exacta ni titularidad.',
                            isP2P: true,
                            addressFamily: 4,
                            endpointRole: 'direct_candidate',
                            baselinePackets: 10,
                            activeCallPackets: 90,
                            phaseCounts: {
                                version: 1,
                                baseline: { packets: 10, bytes: 1200 },
                                negotiation: { packets: 10, bytes: 1200 },
                                active: { packets: 70, bytes: 8400 },
                                postCall: { packets: 10, bytes: 1200 },
                                unclassified: { packets: 0, bytes: 0 },
                            },
                            protocolEvidence: ['transport_flow'],
                            scoreVersion: 3,
                            networkContext: {
                                version: 1,
                                targetCallingCode: '57',
                                targetCountryCode: 'CO',
                                observedCountryCode: 'US',
                                relationship: 'mismatch',
                                affectsRouteScore: false,
                                reasonCodes: ['PHONE_GEO_CONTEXT_MISMATCH'],
                                limitations: ['phone_prefix_is_context_not_location'],
                            },
                            scoreBreakdown: {
                                version: 3,
                                rawScore: 70,
                                finalScore: 55,
                                inputs: {
                                    packets: 90,
                                    bytesTotal: 10800,
                                    durationSec: 8,
                                    direction: 'bidirectional',
                                    ports: [443],
                                    baselinePackets: 10,
                                    baselineDurationSec: 2,
                                    onsetDelayMs: 250,
                                    protocolEvidence: ['transport_flow'],
                                },
                                components: [{ code: 'UNIT', label: 'Unit reason', delta: 70 }],
                                caps: [{ code: 'UNIT_CAP', maximum: 55, before: 70, after: 55 }],
                            },
                        },
                        {
                            ip: '198.51.100.50',
                            packets: 2,
                            bytesTotal: 600,
                            firstSeen: new Date('2026-06-18T00:00:02.000Z'),
                            lastSeen: new Date('2026-06-18T00:00:03.000Z'),
                            avgSize: 300,
                            ports: [443],
                            direction: 'outgoing',
                            provider: 'akamai',
                            networkCategory: 'cloud_or_cdn',
                            networkIntelligence: {
                                asn: 20940,
                                org: 'Akamai',
                                category: 'cdn',
                                source: 'local_rules',
                                isDatacenterLikely: true,
                                exclusionDecision: {
                                    version: 1,
                                    classification: 'contextual',
                                    basis: 'registry',
                                    reasonCodes: ['CDN_CONTEXT'],
                                },
                            },
                            geo: null,
                            confidence: 'low',
                            confidenceScore: 16,
                            reasonCodes: [{ code: 'TINY_SAMPLE', label: 'Tiny sample', delta: -15 }],
                            technicalNote: 'Observacion no concluyente; puede ser CDN o infraestructura.',
                            isP2P: false,
                        },
                    ],
                    metaIps: ['192.0.2.50'],
                    verdict: 'mixed',
                    captureInterface: 'unit0',
                    routeAssessment: {
                        assessmentVersion: 3,
                        classification: 'mixed',
                        confidenceScore: 82,
                        evidenceSources: ['packet_flow', 'baileys_transport'],
                        independentDirectEvidenceCount: 2,
                        primaryCandidateIp: '203.0.113.50',
                        reasonCodes: ['DIRECT_CONFIRMED_WITH_RELAY'],
                        limitations: ['synthetic_limitation'],
                    },
                },
            ],
            activityStats: [
                {
                    targetJid: 'synthetic-contact@s.whatsapp.net',
                    stats: {
                        online: 42,
                        standby: 18,
                        calibrating: 5,
                        noAck: 30,
                        offline: 30,
                        unknown: 5,
                        totalMeasurements: 1200,
                        conclusiveMeasurements: 720,
                        inconclusiveMeasurements: 480,
                        acknowledgedRttMeasurements: 780,
                        firstSeen: new Date('2026-06-17T00:00:00.000Z'),
                        lastSeen: new Date('2026-06-18T00:00:00.000Z'),
                        lastOnline: new Date('2026-06-17T23:30:00.000Z'),
                        avgRtt: 88,
                        observedActivity: {
                            totalEvents: 2,
                            activeEvents: 2,
                            firstEvent: { timestamp: new Date('2026-06-17T18:00:00.000Z') },
                            lastEvent: {
                                source: 'receipt',
                                type: 'delivered',
                                label: 'Mensaje entregado',
                                confidence: 'high',
                                timestamp: new Date('2026-06-17T18:02:00.000Z'),
                                timestampUtc: '2026-06-17T18:02:00.000Z',
                            },
                            bySource: { message: 1, receipt: 1 },
                            confidence: { high: 2 },
                            activeDays: 1,
                        },
                        insights: {
                            periods: [
                                { key: 'last24h', label: '24h', totalMeasurements: 300, conclusiveMeasurements: 240, onlineMeasurements: 120, onlinePct: 50, avgRtt: 80, changeOnlinePct: 5 },
                                { key: 'last7d', label: '7d', totalMeasurements: 900, conclusiveMeasurements: 720, onlineMeasurements: 360, onlinePct: 50, avgRtt: 85, changeOnlinePct: -2 },
                                { key: 'last30d', label: '30d', totalMeasurements: 1200, conclusiveMeasurements: 720, onlineMeasurements: 504, onlinePct: 70, avgRtt: 88, changeOnlinePct: null },
                            ],
                            dailyCoverage: [
                                { date: '2026-06-17', totalMeasurements: 300, onlinePct: 40, coverageScore: 100 },
                                { date: '2026-06-18', totalMeasurements: 220, onlinePct: 41, coverageScore: 100 },
                            ],
                            reliability: {
                                score: 85,
                                label: 'strong',
                                reasonCodes: ['ENOUGH_7D_VOLUME'],
                            },
                        },
                    },
                },
            ],
            observedActivity: [
                {
                    targetJid: 'synthetic-contact@s.whatsapp.net',
                    events: [
                        {
                            source: 'message',
                            type: 'outgoing',
                            label: 'Mensaje enviado (text)',
                            confidence: 'high',
                            timestamp: new Date('2026-06-17T18:00:00.000Z'),
                            timestampUtc: '2026-06-17T18:00:00.000Z',
                        },
                        {
                            source: 'receipt',
                            type: 'delivered',
                            label: 'Mensaje entregado',
                            confidence: 'high',
                            timestamp: new Date('2026-06-17T18:02:00.000Z'),
                            timestampUtc: '2026-06-17T18:02:00.000Z',
                        },
                    ],
                    page: { returned: 2, total: 2, truncated: false, limit: 5000 },
                },
            ],
            networkSummary: {
                captureStartCount: 1,
                captureStopCount: 1,
                latestStats: { totalPackets: 120 },
                captures: [
                    {
                        timestampUtc: '2026-06-18T00:00:10.000Z',
                        operatorName: 'QA',
                        stats: { totalPackets: 120 },
                    },
                ],
            },
        },
        integrity: {
            algorithm: 'SHA-256',
            sectionHashes: {},
            packageHash: 'source-package-hash',
            canonicalPayload: 'unit',
        },
    };
}

test('builds final reports with candidate IP limitations and integrity', () => {
    const report = buildFinalCaseReport(sampleEvidencePackage());

    assert.equal(report.version, '1.3');
    assert.equal(report.summary.caseId, 'CASE-UNIT-001');
    assert.equal(report.summary.candidateIpCount, 1);
    assert.equal(report.summary.nonConclusiveIpObservationCount, 1);
    assert.equal(report.summary.activityStatsCount, 1);
    assert.equal(report.summary.observedActivityEventCount, 2);
    assert.equal(report.summary.observedActivityTotalAvailable, 2);
    assert.equal(report.summary.observedActivityTruncated, false);
    assert.equal(report.summary.highestCandidateScore, 55);
    assert.equal(report.summary.routeAssessmentCount, 1);
    assert.equal(report.findings.callRoutes[0]?.classification, 'mixed');
    assert.equal(report.findings.callRoutes[0]?.independentDirectEvidenceCount, 2);
    assert.deepEqual(report.findings.callRoutes[0]?.presentation, {
        classificationLabel: 'Ruta mixta observada',
        confidenceLabel: 'Alta',
        evidenceLabels: ['Flujo de red observado', 'Señalización de llamada'],
        reasonLabels: ['La ruta directa confirmada coexistió con tráfico de relay.'],
        limitationLabels: ['Synthetic limitation'],
    });
    const [activityStats] = report.findings.activityStats;
    const [candidateIp] = report.findings.candidateIps;
    const [nonConclusiveIp] = report.findings.nonConclusiveIpObservations;
    assert.ok(activityStats);
    assert.ok(candidateIp);
    assert.ok(nonConclusiveIp);
    assert.equal(report.summary.observedEndpointCount, 2);
    assert.equal(report.findings.observedEndpoints.length, 2);
    assert.equal(activityStats.reliability.score, 85);
    assert.equal(activityStats.calibratingPct, 5);
    assert.equal(activityStats.noAckPct, 30);
    assert.equal(activityStats.unknownPct, 5);
    assert.equal(activityStats.conclusiveMeasurements, 720);
    assert.equal(activityStats.inconclusiveMeasurements, 480);
    assert.equal(activityStats.acknowledgedRttMeasurements, 780);
    assert.equal(activityStats.observedEventCount, 2);
    assert.equal(activityStats.observedBySource.receipt, 1);
    assert.equal(report.findings.observedSignals[1]?.label, 'Mensaje entregado');
    assert.equal(candidateIp.networkIntelligence.org, 'Google');
    assert.equal(candidateIp.bytesTotal, 12000);
    assert.equal(candidateIp.firstSeen.toISOString(), '2026-06-18T00:00:01.000Z');
    assert.equal(candidateIp.endpointRole, 'direct_candidate');
    assert.deepEqual(candidateIp.protocolEvidence, ['transport_flow']);
    assert.equal(candidateIp.phaseCounts.active.packets, 70);
    assert.equal(candidateIp.networkContext.relationship, 'mismatch');
    assert.equal(candidateIp.networkContextPresentation.contradiction, true);
    assert.equal(candidateIp.networkContextPresentation.affectsRouteScore, false);
    assert.equal(candidateIp.networkContextPresentation.uncertainty.radiusKm, null);
    assert.equal(candidateIp.networkContextPresentation.uncertainty.status, 'not_quantified_by_provider');
    assert.equal(candidateIp.scoreBreakdown.finalScore, 55);
    assert.equal(report.findings.callRoutes[0]?.contextContradictions.length, 1);
    assert.equal(nonConclusiveIp.networkIntelligence.org, 'Akamai');
    assert.equal(nonConclusiveIp.networkIntelligence.exclusionDecision.classification, 'contextual');
    assert.match(report.integrity.reportHash, /^[a-f0-9]{64}$/);

    const html = renderFinalCaseReportHtml(report);
    assert.match(html, /ASN\/ORG/);
    assert.match(html, /Señales de Actividad Observada/);
    assert.match(html, /Mensaje entregado/);
    assert.match(html, /Actividad y Medición Técnica/);
    assert.match(html, /720 \/ 1200/);
    assert.match(html, /En línea \/ concl\. 24h/);
    assert.match(html, /85\/100/);
    assert.match(html, /No prueban identidad/);
    assert.match(html, /Observaciones No Concluyentes/);
    assert.match(html, /Estado: Autorizado/);
    assert.match(html, /Red de acceso o proveedor no confirmado/);
    assert.match(html, /Bidireccional/);
    assert.match(html, /Confirmación/);
    assert.match(html, /Alta/);
    assert.match(html, /Captura de llamada finalizada/);
    assert.match(html, /Fuerte/);
    assert.match(html, /Ruta de Llamada Observada/);
    assert.match(html, /Ruta mixta observada/);
    assert.match(html, /Flujo de red observado · Señalización de llamada/);
    assert.match(html, /La ruta directa confirmada coexistió con tráfico de relay/);
    assert.match(html, /Contexto de red divergente/);
    assert.match(html, /Radio no cuantificado por la fuente GeoIP/);
    assert.match(html, /Contradicciones contextuales: 1/);
    assert.doesNotMatch(html, />authorized</);
    assert.doesNotMatch(html, />consumer_isp_or_unknown</);
    assert.doesNotMatch(html, />Scope</);
    assert.doesNotMatch(html, />Target</);

    const pdf = renderFinalCaseReportPdf(report);
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
    const pdfText = pdf.toString('ascii');
    assert.match(pdfText, /Estado: Autorizado/);
    assert.match(pdfText, /Puntaje maximo/);
    assert.match(pdfText, /Captura de llamada finalizada/);
    assert.match(pdfText, /Ruta mixta observada - Alta 82\/100/);
    assert.match(pdfText, /Procedencia: Flujo de red observado, Senalizacion de llamada/);
    assert.match(pdfText, /Radio no cuantificado por la/);
    assert.match(pdfText, /fuente GeoIP/);
    assert.match(pdfText, /Contexto: 1 contradiccion/);
    assert.match(pdfText, /geografica/);
    const routePage = pdfText.split('endstream').find(page => page.includes('Ruta mixta observada'));
    assert.ok(routePage);
    assert.match(routePage, /RUTA DE LLAMADA OBSERVADA/);
    assert.match(routePage, /Alcance: Synthetic limitation/);
    assert.match(pdfText, /\(Red de acceso o proveedor\) Tj/);
    assert.match(pdfText, /\(no confirmado\) Tj/);
    assert.doesNotMatch(pdfText, /\(Red de acceso o proveedor no confirmado\) Tj/);
    assert.doesNotMatch(pdfText, /consumer_isp_or_unknown/);
    assert.doesNotMatch(pdfText, /Timeline de auditoria/);
});

test('bounds aggregate evidence allocation across all referenced targets', () => {
    assert.deepEqual(allocateEvidenceRecordLimits([3000, 3000, 50], 5000), [3000, 2000, 0]);
    assert.deepEqual(allocateEvidenceRecordLimits([2, Number.NaN, -4, 3], 10), [2, 0, 0, 3]);
    assert.deepEqual(allocateEvidenceRecordLimits([3, 4], 0), [0, 0]);
});

test('declares the same endpoint presentation limit in JSON, HTML and PDF', () => {
    const evidencePackage = sampleEvidencePackage();
    const [candidate, observation] = evidencePackage.sections.callAnalysis[0].candidateIps;
    evidencePackage.sections.callAnalysis[0].candidateIps = [
        ...Array.from({ length: 12 }, (_, index) => ({
            ...candidate,
            ip: `198.51.100.${index + 1}`,
        })),
        ...Array.from({ length: 12 }, (_, index) => ({
            ...observation,
            ip: `203.0.113.${index + 1}`,
        })),
    ];

    const report = buildFinalCaseReport(evidencePackage);
    assert.equal(report.findings.presentationLimits.candidateIps, 10);
    assert.equal(report.findings.presentationLimits.nonConclusiveIpObservations, 10);
    assert.equal(report.findings.candidateIps.length, 12);
    assert.equal(report.findings.nonConclusiveIpObservations.length, 12);

    const html = renderFinalCaseReportHtml(report);
    assert.match(html, /se presentan 10 de 12 IPs candidatas/i);
    assert.match(html, /se presentan 10 de 12 observaciones no concluyentes/i);

    const pdf = renderFinalCaseReportPdf(report).toString('ascii');
    assert.match(pdf, /se presentan 10 de 12 IPs candidatas/i);
    assert.match(pdf, /se presentan 10 de 12 observaciones no concluyentes/i);
});

test('fails evidence export closed when its database snapshot cannot be read', async () => {
    await assert.rejects(
        buildEvidencePackage('CASE-DATABASE-UNAVAILABLE'),
        /Database is unavailable while/,
    );
});

test('declares when passive activity is truncated instead of presenting a partial export as complete', () => {
    const evidencePackage = sampleEvidencePackage();
    evidencePackage.sections.observedActivity[0].page = {
        returned: 2,
        total: 8,
        truncated: true,
        limit: 2,
    };

    const report = buildFinalCaseReport(evidencePackage);
    assert.equal(report.summary.observedActivityEventCount, 2);
    assert.equal(report.summary.observedActivityTotalAvailable, 8);
    assert.equal(report.summary.observedActivityTruncated, true);
    assert.match(renderFinalCaseReportHtml(report), /incluye 2 de 8 señales disponibles/i);
});

test('builds evidence ZIP with CSV annexes and integrity manifest', () => {
    const zip = buildEvidenceZip(sampleEvidencePackage());
    const zipText = zip.toString('latin1');

    for (const name of [
        'manifest.json',
        'final-report.pdf',
        'activity-stats.json',
        'observed-activity.json',
        'annexes/audit-events.csv',
        'annexes/evidence-links.csv',
        'annexes/call-analysis.csv',
        'annexes/activity-stats.csv',
        'annexes/observed-activity.csv',
        'annexes/candidate-ips.csv',
        'annexes/observed-endpoints.csv',
        'annexes/non-conclusive-ip-observations.csv',
        'annexes/network-captures.csv',
        'annexes/csv-integrity.json',
    ]) {
        assert.match(zipText, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(zipText, /routeClassification/);
    assert.match(zipText, /phaseCountsJson/);
    assert.match(zipText, /bytesTotal/);
    assert.match(zipText, /exclusionClassification/);
    assert.match(zipText, /CDN_CONTEXT/);
    assert.match(zipText, /DIRECT_CONFIRMED_WITH_RELAY/);
    assert.match(zipText, /Ruta mixta observada/);
    assert.match(zipText, /Flujo de red observado/);
    assert.match(zipText, /networkContextPresentationJson/);
    assert.match(zipText, /scoreBreakdownJson/);
    assert.match(zipText, /not_quantified_by_provider/);
    assert.match(zipText, /geographicContextAffectsRouteScore/);
});

test('keeps OBS-29 protocol provenance aligned across report, HTML, PDF, ZIP, and CSV', () => {
    const evidencePackage = sampleEvidencePackage();
    const analysis = evidencePackage.sections.callAnalysis[0];
    analysis.routeAssessment = {
        assessmentVersion: 4,
        classification: 'direct_confirmed',
        confidenceScore: 82,
        evidenceSources: ['packet_flow', 'browser_webrtc', 'five_tuple_flow', 'stun_turn'],
        independentDirectEvidenceCount: 2,
        primaryCandidateIp: '203.0.113.50',
        reasonCodes: ['BROWSER_SELECTED_CANDIDATE_MATCHES_ACTIVE_FIVE_TUPLE'],
        limitations: [],
    };
    analysis.browserWebRtcEvidence = {
        version: 1,
        status: 'available',
        startedAt: new Date('2026-06-18T00:00:00.000Z'),
        endedAt: new Date('2026-06-18T00:00:10.000Z'),
        connectionCount: 1,
        selectedPairs: [{
            peerConnectionId: 'pc-1',
            state: 'succeeded',
            nominated: true,
            selected: true,
            firstObservedAt: new Date('2026-06-18T00:00:01.000Z'),
            lastObservedAt: new Date('2026-06-18T00:00:09.000Z'),
            local: { candidateType: 'host', protocol: 'udp', relayProtocol: 'unknown', address: null, addressFamily: null, port: 50_000 },
            remote: { candidateType: 'srflx', protocol: 'udp', relayProtocol: 'unknown', address: '203.0.113.50', addressFamily: 4, port: 443 },
            packetsSent: 50,
            packetsReceived: 50,
            bytesSent: 6_000,
            bytesReceived: 6_000,
            currentRoundTripTimeMs: 25,
        }],
        stateTransitions: [],
        truncated: false,
        limitations: [],
    };
    analysis.flowEvidence = {
        version: 1,
        flowLimit: 1_024,
        storedFlows: 3,
        droppedPackets: 0,
        truncated: false,
        flows: [
            {
                addressFamily: 4,
                protocol: 'udp',
                localPort: 50_000,
                remoteIp: '203.0.113.50',
                remotePort: 443,
                firstSeen: new Date('2026-06-18T00:00:01.000Z'),
                lastSeen: new Date('2026-06-18T00:00:09.000Z'),
                direction: 'bidirectional',
                packets: 100,
                bytesTotal: 12_000,
                phaseCounts: {
                    version: 1,
                    baseline: { packets: 10, bytes: 1_200 },
                    negotiation: { packets: 10, bytes: 1_200 },
                    active: { packets: 70, bytes: 8_400 },
                    postCall: { packets: 10, bytes: 1_200 },
                    unclassified: { packets: 0, bytes: 0 },
                },
                protocolEvidence: ['transport_flow'],
            },
            {
                addressFamily: 4, protocol: 'udp', localPort: 50_001,
                remoteIp: '192.0.2.60', remotePort: 34_78,
                firstSeen: new Date('2026-06-18T00:00:02.000Z'), lastSeen: new Date('2026-06-18T00:00:03.000Z'),
                direction: 'outgoing', packets: 1, bytesTotal: 120,
                phaseCounts: { version: 1, baseline: { packets: 0, bytes: 0 }, negotiation: { packets: 1, bytes: 120 }, active: { packets: 0, bytes: 0 }, postCall: { packets: 0, bytes: 0 }, unclassified: { packets: 0, bytes: 0 } },
                protocolEvidence: ['transport_flow'],
            },
            {
                addressFamily: 4, protocol: 'udp', localPort: 50_002,
                remoteIp: '192.0.2.61', remotePort: 34_78,
                firstSeen: new Date('2026-06-18T00:00:02.000Z'), lastSeen: new Date('2026-06-18T00:00:03.000Z'),
                direction: 'incoming', packets: 1, bytesTotal: 120,
                phaseCounts: { version: 1, baseline: { packets: 0, bytes: 0 }, negotiation: { packets: 1, bytes: 120 }, active: { packets: 0, bytes: 0 }, postCall: { packets: 0, bytes: 0 }, unclassified: { packets: 0, bytes: 0 } },
                protocolEvidence: ['transport_flow'],
            },
        ],
    };
    analysis.stunTurnEvidence = {
        version: 1,
        transactionLimit: 256,
        storedTransactions: 4,
        droppedTransactions: 0,
        truncated: false,
        transactions: Array.from({ length: 4 }, (_, index) => ({
            transactionFingerprint: String(index + 1).repeat(64),
            method: 'binding',
            firstObservedAt: new Date('2026-06-18T00:00:01.000Z'),
            lastObservedAt: new Date('2026-06-18T00:00:02.000Z'),
            requestObserved: true,
            successResponseObserved: true,
            errorResponseObserved: false,
            requestDirection: 'outgoing',
            responseDirection: 'incoming',
            useCandidate: false,
            iceRole: 'unknown',
            channelNumber: null,
            endpointKeys: [],
        })),
        channels: [{
            channelNumber: 0x4001,
            peerEndpointKey: '203.0.113.50:443',
            firstObservedAt: new Date('2026-06-18T00:00:03.000Z'),
            lastObservedAt: new Date('2026-06-18T00:00:09.000Z'),
            packets: 10,
            bytesTotal: 1_200,
        }],
        limitations: [],
    };

    const report = buildFinalCaseReport(evidencePackage);
    const route = report.findings.callRoutes[0];
    assert.equal(route?.browserWebRtcStatus, 'available');
    assert.equal(route?.browserSelectedPairCount, 1);
    assert.equal(route?.exposedRemoteCandidateCount, 1);
    assert.equal(route?.flowCount, 3);
    assert.equal(route?.stunTransactionCount, 4);
    assert.equal(route?.turnChannelCount, 1);

    const html = renderFinalCaseReportHtml(report);
    const pdf = renderFinalCaseReportPdf(report).toString('ascii');
    const zip = buildEvidenceZip(evidencePackage);
    const zipText = zip.toString('latin1');
    const callCsv = readStoredZipEntry(zip, 'annexes/call-analysis.csv');
    assert.match(html, /WebRTC: available · pares 1 · flujos 3 · STUN\/TURN 4/);
    assert.match(pdf, /WebRTC: available; pares seleccionados: 1; flujos: 3/);
    assert.match(pdf, /transacciones STUN\/TURN: 4/);
    assert.match(zipText, /browserWebRtcStatus/);
    assert.match(callCsv, /"browserWebRtcStatus","browserSelectedPairCount","browserExposedRemoteCandidateCount","flowCount","stunTransactionCount","turnChannelCount"/);
    assert.match(callCsv, /"available","1","1","3","4","1"/);
});

test('keeps route conclusions commercially equivalent across JSON, HTML and PDF', () => {
    const expected = [
        [{ classification: 'direct_confirmed', confidenceScore: 82, independentDirectEvidenceCount: 2, primaryCandidateIp: '203.0.113.50', evidenceSources: ['packet_flow', 'baileys_transport'] }, 'Ruta directa confirmada'],
        [{ classification: 'direct_probable', confidenceScore: 68, independentDirectEvidenceCount: 1, primaryCandidateIp: '203.0.113.50', evidenceSources: ['packet_flow'] }, 'Ruta directa probable'],
        [{ classification: 'relay_confirmed', confidenceScore: 78, independentDirectEvidenceCount: 0, primaryCandidateIp: null, evidenceSources: ['packet_flow'] }, 'Conexion mediante infraestructura de WhatsApp'],
        [{ classification: 'mixed', confidenceScore: 82, independentDirectEvidenceCount: 2, primaryCandidateIp: '203.0.113.50', evidenceSources: ['packet_flow', 'baileys_transport'] }, 'Ruta mixta observada'],
        [{ classification: 'unresolved', confidenceScore: 20, independentDirectEvidenceCount: 0, primaryCandidateIp: null, evidenceSources: ['packet_flow'] }, 'Ruta no determinada'],
    ] as const;

    for (const [routeFields, pdfLabel] of expected) {
        const evidencePackage = sampleEvidencePackage();
        Object.assign(evidencePackage.sections.callAnalysis[0].routeAssessment, routeFields);
        const report = buildFinalCaseReport(evidencePackage);
        const html = renderFinalCaseReportHtml(report);
        const pdf = renderFinalCaseReportPdf(report).toString('ascii');
        const [route] = report.findings.callRoutes;
        assert.ok(route);
        const jsonLabel = route.presentation.classificationLabel;

        assert.match(html, new RegExp(jsonLabel));
        assert.match(pdf, new RegExp(pdfLabel));
    }
});

test('labels legacy analyses without inventing v2 route evidence', () => {
    const evidencePackage = sampleEvidencePackage();
    delete evidencePackage.sections.callAnalysis[0].routeAssessment;

    const report = buildFinalCaseReport(evidencePackage);
    const [route] = report.findings.callRoutes;

    assert.ok(route);
    assert.equal(route.classification, 'unresolved');
    assert.deepEqual(route.reasonCodes, []);
    assert.deepEqual(route.limitations, ['legacy_route_assessment_unavailable']);
    assert.match(renderFinalCaseReportHtml(report), /captura es histórica y no contiene una evaluación de ruta v2/i);
});

test('bounds route conclusions and declares partial coverage in every final report format', () => {
    const evidencePackage = sampleEvidencePackage();
    const template = evidencePackage.sections.callAnalysis[0];
    evidencePackage.sections.callAnalysis = Array.from({ length: 251 }, (_, index) => ({
        ...template,
        callId: `CALL-${String(index + 1).padStart(3, '0')}`,
    }));

    const report = buildFinalCaseReport(evidencePackage);
    const html = renderFinalCaseReportHtml(report);
    const pdf = renderFinalCaseReportPdf(report).toString('ascii');

    assert.equal(report.version, '1.3');
    assert.equal(report.findings.callRoutes.length, 250);
    assert.deepEqual(report.findings.callRouteCoverage, {
        returned: 250,
        knownTotal: 251,
        limit: 250,
        truncated: true,
        sourceTruncated: false,
        sourceIncomplete: false,
        totalIsLowerBound: false,
    });
    assert.match(html, /presenta 250 de 251 evaluaciones/);
    assert.match(pdf, /Cobertura parcial: se presentan 250 de 251 evaluaciones/);
    assert.match(pdf, /CALL-250/);
    assert.doesNotMatch(pdf, /CALL-251/);
});

test('degrades malformed stored route assessments without breaking exports', () => {
    const evidencePackage = sampleEvidencePackage();
    evidencePackage.sections.callAnalysis[0].routeAssessment = {
        assessmentVersion: 2,
        classification: 'direct_confirmed',
        confidenceScore: 100,
        evidenceSources: 'packet_flow',
        independentDirectEvidenceCount: 2,
        primaryCandidateIp: '203.0.113.50',
        reasonCodes: [],
        limitations: [],
    };

    const report = buildFinalCaseReport(evidencePackage);
    const [route] = report.findings.callRoutes;

    assert.ok(route);
    assert.equal(route.classification, 'unresolved');
    assert.equal(route.confidenceScore, 0);
    assert.deepEqual(route.evidenceSources, []);
    assert.deepEqual(route.limitations, ['stored_observation_invalid']);
    assert.match(renderFinalCaseReportHtml(report), /observación almacenada no superó la validación/i);
    assert.match(renderFinalCaseReportPdf(report).toString('ascii'), /observacion almacenada no supero la validacion/i);
});

test('propagates partial source coverage even when the rendered route page is short', () => {
    const evidencePackage = sampleEvidencePackage();
    evidencePackage.manifest.coverage = {
        audit: { returned: 5000, total: 5100, truncated: true, limit: 5000 },
        evidenceLinks: { returned: 1, total: 1, truncated: false, limit: 5000 },
        callAnalysis: {
            returned: 1,
            referenced: 1,
            missingReferences: 0,
            limit: 5000,
            truncated: true,
            referenceTotalIsLowerBound: true,
        },
    };

    const report = buildFinalCaseReport(evidencePackage);

    assert.deepEqual(report.findings.callRouteCoverage, {
        returned: 1,
        knownTotal: 1,
        limit: 250,
        truncated: true,
        sourceTruncated: true,
        sourceIncomplete: true,
        totalIsLowerBound: true,
    });
    assert.match(renderFinalCaseReportHtml(report), /Evidence Package fuente declara cobertura parcial/);
});
