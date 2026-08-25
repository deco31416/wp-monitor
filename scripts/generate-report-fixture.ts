import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
    buildEvidenceZip,
    buildFinalCaseReport,
    renderFinalCaseReportHtml,
    renderFinalCaseReportPdf,
} from '../src/evidence-package.js';
import { SOFTWARE_VERSION } from '../src/version.js';

const OUTPUT_DIRECTORY = resolve('.runtime-logs/report-fixture');

function syntheticEvidencePackage(): any {
    const caseId = 'CASE-FIXTURE-001';
    const targetJid = 'synthetic-contact@s.whatsapp.net';
    return {
        manifest: {
            packageType: 'evidence-package',
            version: '1.1',
            software: {
                name: 'WP MONITOR',
                version: SOFTWARE_VERSION,
                developedBy: 'WP MONITOR',
            },
            caseId,
            generatedAt: '2026-06-18T00:00:00.000Z',
            contents: [],
            limitations: [
                'Fixture sintético de QA; no contiene datos de clientes ni de producción.',
                'Las IP candidatas no prueban identidad, ubicación exacta ni titularidad de una persona.',
            ],
        },
        sections: {
            case: {
                caseId,
                title: 'Fixture sintético de informe QA',
                status: 'authorized',
                primaryOperator: 'qa-operator',
                authorizationNote: 'Fixture sintético autorizado para control de calidad',
                description: 'Datos no productivos para verificar reportes y empaquetado ZIP.',
                tags: ['qa', 'synthetic'],
            },
            audit: [{
                caseId,
                operatorName: 'qa-operator',
                authorizationNote: 'Fixture sintético autorizado para control de calidad',
                action: 'call_capture_stop',
                scope: 'call',
                targetJid,
                details: { callId: 'CALL-FIXTURE-001' },
                timestamp: new Date('2026-06-18T00:00:10.000Z'),
                timestampUtc: '2026-06-18T00:00:10.000Z',
            }],
            evidenceLinks: [{
                caseId,
                type: 'call_analysis',
                refId: 'CALL-FIXTURE-001',
                label: 'Análisis sintético de llamada',
                targetJid,
                metadata: { source: 'qa-fixture' },
                createdAt: new Date('2026-06-18T00:00:11.000Z'),
                updatedAt: new Date('2026-06-18T00:00:11.000Z'),
            }],
            callAnalysis: [{
                callId: 'CALL-FIXTURE-001',
                targetJid,
                startTime: new Date('2026-06-18T00:00:00.000Z'),
                endTime: new Date('2026-06-18T00:00:10.000Z'),
                durationSec: 10,
                isVideo: false,
                totalPackets: 120,
                candidateIps: [{
                    ip: '203.0.113.50',
                    packets: 100,
                    bytesTotal: 12_000,
                    firstSeen: new Date('2026-06-18T00:00:01.000Z'),
                    lastSeen: new Date('2026-06-18T00:00:09.000Z'),
                    avgSize: 120,
                    ports: [443],
                    direction: 'bidirectional',
                    provider: 'synthetic-consumer-network',
                    networkCategory: 'consumer_isp_or_unknown',
                    networkIntelligence: {
                        asn: 64_496,
                        org: 'Documentation Network',
                        category: 'consumer_isp_or_unknown',
                        source: 'qa_fixture',
                        isDatacenterLikely: false,
                    },
                    geo: null,
                    confidence: 'medium',
                    confidenceScore: 55,
                    reasonCodes: [{ code: 'SYNTHETIC', label: 'Observación sintética de QA', delta: 1 }],
                    technicalNote: 'IP de documentación sintética; no identifica un host ni una persona real.',
                    isP2P: true,
                }],
                metaIps: ['192.0.2.50'],
                verdict: 'mixed',
                captureInterface: 'fixture0',
            }],
            activityStats: [{
                targetJid,
                stats: {
                    online: 42,
                    standby: 18,
                    calibrating: 5,
                    noAck: 30,
                    offline: 30,
                    unknown: 5,
                    totalMeasurements: 1_200,
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
                        bySource: { message: 1, receipt: 1 },
                        confidence: { high: 2 },
                        activeDays: 1,
                        lastEvent: {
                            label: 'Mensaje entregado',
                            timestamp: new Date('2026-06-17T18:02:00.000Z'),
                        },
                    },
                    insights: {
                        periods: [
                            { key: 'last24h', label: '24h', totalMeasurements: 300, conclusiveMeasurements: 240, onlineMeasurements: 120, onlinePct: 50, avgRtt: 80, changeOnlinePct: 5 },
                            { key: 'last7d', label: '7d', totalMeasurements: 900, conclusiveMeasurements: 720, onlineMeasurements: 360, onlinePct: 50, avgRtt: 85, changeOnlinePct: -2 },
                            { key: 'last30d', label: '30d', totalMeasurements: 1_200, conclusiveMeasurements: 720, onlineMeasurements: 504, onlinePct: 70, avgRtt: 88, changeOnlinePct: null },
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
            }],
            observedActivity: [{
                targetJid,
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
            }],
            networkSummary: {
                captureStartCount: 1,
                captureStopCount: 1,
                latestStats: { totalPackets: 120 },
                captures: [{
                    timestampUtc: '2026-06-18T00:00:10.000Z',
                    operatorName: 'qa-operator',
                    stats: { totalPackets: 120 },
                }],
            },
        },
        integrity: {
            algorithm: 'SHA-256',
            sectionHashes: {},
            packageHash: createHash('sha256').update('synthetic-evidence-package').digest('hex'),
            canonicalPayload: 'synthetic QA fixture',
        },
    };
}

function sha256(data: string | Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

async function main(): Promise<void> {
    const evidencePackage = syntheticEvidencePackage();
    const finalReport = buildFinalCaseReport(evidencePackage);
    const html = renderFinalCaseReportHtml(finalReport);
    const pdf = renderFinalCaseReportPdf(finalReport);
    const zip = buildEvidenceZip(evidencePackage);
    const evidenceJson = JSON.stringify(evidencePackage, null, 2);
    const reportJson = JSON.stringify(finalReport, null, 2);

    if (!html.includes('CASE-FIXTURE-001')) throw new Error('HTML fixture is missing the case ID');
    if (pdf.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('PDF fixture has an invalid header');
    for (const expectedEntry of ['manifest.json', 'observed-activity.json', 'final-report.html', 'final-report.pdf', 'annexes/observed-activity.csv', 'annexes/csv-integrity.json']) {
        if (!zip.toString('latin1').includes(expectedEntry)) throw new Error(`ZIP fixture is missing ${expectedEntry}`);
    }

    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    const artifacts: Array<[string, string | Buffer]> = [
        ['evidence-package.json', evidenceJson],
        ['final-report.json', reportJson],
        ['final-report.html', html],
        ['final-report.pdf', pdf],
        ['evidence-package.zip', zip],
    ];
    for (const [name, data] of artifacts) {
        await writeFile(resolve(OUTPUT_DIRECTORY, name), data);
    }

    const manifest = {
        fixture: 'WP MONITOR synthetic report fixture',
        caseId: evidencePackage.manifest.caseId,
        generatedAt: finalReport.summary.generatedAt,
        artifacts: artifacts.map(([name, data]) => ({
            name,
            bytes: Buffer.byteLength(data),
            sha256: sha256(data),
        })),
    };
    await writeFile(resolve(OUTPUT_DIRECTORY, 'fixture-manifest.json'), JSON.stringify(manifest, null, 2));

    console.log(`[QA] Report fixture PASS: ${artifacts.length} artifacts in .runtime-logs/report-fixture`);
}

await main();
