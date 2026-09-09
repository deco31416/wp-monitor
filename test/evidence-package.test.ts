import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateEvidenceRecordLimits, buildEvidencePackage, buildEvidenceZip, buildFinalCaseReport, renderFinalCaseReportHtml, renderFinalCaseReportPdf } from '../src/evidence-package.js';

function sampleEvidencePackage(): any {
    return {
        manifest: {
            packageType: 'evidence-package',
            version: '1.2',
            software: {
                name: 'WP MONITOR',
                version: '2.6.0',
                developedBy: 'WP MONITOR',
            },
            caseId: 'CASE-UNIT-001',
            generatedAt: '2026-06-18T00:00:00.000Z',
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
                            geo: null,
                            confidence: 'medium',
                            confidenceScore: 55,
                            reasonCodes: [{ code: 'UNIT', label: 'Unit reason', delta: 1 }],
                            technicalNote: 'IP publica observada como candidata tecnica. No confirma identidad, ubicacion exacta ni titularidad.',
                            isP2P: true,
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
                        assessmentVersion: 2,
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

    assert.equal(report.version, '1.2');
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
    assert.equal(nonConclusiveIp.networkIntelligence.org, 'Akamai');
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
        'annexes/non-conclusive-ip-observations.csv',
        'annexes/network-captures.csv',
        'annexes/csv-integrity.json',
    ]) {
        assert.match(zipText, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.match(zipText, /routeClassification/);
    assert.match(zipText, /DIRECT_CONFIRMED_WITH_RELAY/);
    assert.match(zipText, /Ruta mixta observada/);
    assert.match(zipText, /Flujo de red observado/);
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

    assert.equal(report.version, '1.2');
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
