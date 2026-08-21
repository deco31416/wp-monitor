import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceZip, buildFinalCaseReport, renderFinalCaseReportHtml, renderFinalCaseReportPdf } from '../src/evidence-package.js';

function sampleEvidencePackage(): any {
    return {
        manifest: {
            packageType: 'evidence-package',
            version: '1.1',
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

    assert.equal(report.summary.caseId, 'CASE-UNIT-001');
    assert.equal(report.summary.candidateIpCount, 1);
    assert.equal(report.summary.nonConclusiveIpObservationCount, 1);
    assert.equal(report.summary.activityStatsCount, 1);
    assert.equal(report.summary.observedActivityEventCount, 2);
    assert.equal(report.summary.highestCandidateScore, 55);
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
    assert.match(html, /Online \/ concl\. 24h/);
    assert.match(html, /85\/100/);
    assert.match(html, /No prueban identidad/);
    assert.match(html, /Observaciones No Concluyentes/);

    const pdf = renderFinalCaseReportPdf(report);
    assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
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
});
